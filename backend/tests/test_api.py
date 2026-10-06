"""The HTTP API end to end, against a real Postgres database."""

from __future__ import annotations

import uuid

from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.explain import Explainer
from app.explain.llm import ClaudeWriter

from .conftest import FakeClaude, alembic_config, claude_message, fixture, make_client

DIVIDER = fixture("voltage_divider_unequal")["netlist"]  # 12 V, 2 kΩ, 4 kΩ -> v(out) = 8 V


def save(client: TestClient, name: str = "Divider", netlist: dict | None = None) -> dict:  # type: ignore[type-arg]
    response = client.post("/api/circuits", json={"name": name, "netlist": netlist or DIVIDER})
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def test_health_reports_the_explanation_source(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok", "explanations": "template"}


def test_circuit_crud(client: TestClient) -> None:
    created = save(client)
    circuit_id = created["id"]
    assert created["netlist"] == DIVIDER and created["schematic"] is None

    assert client.get(f"/api/circuits/{circuit_id}").json()["name"] == "Divider"

    schematic = {"parts": [], "wires": [], "grounds": []}
    updated = client.put(
        f"/api/circuits/{circuit_id}",
        json={"name": "Renamed", "netlist": DIVIDER, "schematic": schematic},
    ).json()
    assert updated["name"] == "Renamed" and updated["schematic"] == schematic
    assert updated["updated_at"] >= created["updated_at"]

    [summary] = client.get("/api/circuits").json()
    assert summary == {
        "id": circuit_id,
        "name": "Renamed",
        "component_count": 3,
        "updated_at": updated["updated_at"],
    }

    assert client.delete(f"/api/circuits/{circuit_id}").status_code == 204
    assert client.get(f"/api/circuits/{circuit_id}").status_code == 404


def test_list_is_newest_first_and_paginated(client: TestClient) -> None:
    for name in ("one", "two", "three"):
        save(client, name)
    names = [c["name"] for c in client.get("/api/circuits").json()]
    assert names == ["three", "two", "one"]
    assert [c["name"] for c in client.get("/api/circuits?limit=1&offset=1").json()] == ["two"]
    assert client.get("/api/circuits?limit=0").status_code == 422


def test_unsolvable_circuits_can_be_saved_but_malformed_ones_cannot(client: TestClient) -> None:
    no_ground = {
        "version": 1,
        "ground": "gnd",
        "components": [{"id": "R1", "type": "resistor", "a": "a", "b": "b", "value": 1}],
    }
    assert client.post("/api/circuits", json={"name": "WIP", "netlist": no_ground}).status_code == 201

    garbage = {"version": 1, "ground": "gnd", "components": [{"id": "X", "type": "diode"}]}
    response = client.post("/api/circuits", json={"name": "Bad", "netlist": garbage})
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "parse"


def test_missing_circuit_is_404(client: TestClient) -> None:
    assert client.get(f"/api/circuits/{uuid.uuid4()}").status_code == 404
    assert client.post("/api/explain", json={"circuit_id": str(uuid.uuid4())}).status_code == 404


def test_solve_returns_the_solution_or_a_structured_422(client: TestClient) -> None:
    solution = client.post("/api/solve", json={"netlist": DIVIDER}).json()["solution"]
    assert solution["node_voltages"]["out"] == 8.0

    floating = {
        "version": 1,
        "ground": "gnd",
        "components": [
            {"id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 1},
            {"id": "R2", "type": "resistor", "a": "x", "b": "y", "value": 1},
        ],
    }
    response = client.post("/api/solve", json={"netlist": floating})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["kind"] == "floating_nodes" and error["nodes"] == ["x", "y"] and error["message"]


def test_transient_endpoint(client: TestClient) -> None:
    rc = {
        "version": 1,
        "ground": "gnd",
        "components": [
            {
                "id": "C1",
                "type": "capacitor",
                "a": "a",
                "b": "gnd",
                "value": 1e-6,
                "initial_voltage": 1,
            },
            {"id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 1000},
        ],
    }
    response = client.post(
        "/api/solve/transient",
        json={"netlist": rc, "options": {"stop_time": 1e-3, "time_step": 1e-5}},
    )
    assert len(response.json()["solution"]["time"]) == 101
    bad = client.post(
        "/api/solve/transient", json={"netlist": rc, "options": {"stop_time": -1, "time_step": 1}}
    )
    assert bad.status_code == 422 and bad.json()["error"]["kind"] == "invalid_analysis"


def test_oversized_circuits_are_rejected(settings: Settings, db: sessionmaker[Session]) -> None:
    client = make_client(settings.model_copy(update={"max_components": 2}), db, Explainer())
    assert client.post("/api/solve", json={"netlist": DIVIDER}).status_code == 413


def test_explain_inline_netlist(client: TestClient) -> None:
    body = client.post("/api/explain", json={"netlist": DIVIDER}).json()
    assert body["solution"]["node_voltages"]["out"] == 8.0
    explanation = body["explanation"]
    assert explanation["source"] == "template" and explanation["unverified_numbers"] == []
    equations = [s["equation"] for s in explanation["steps"] if s["equation"]]
    assert "(v(out) − 12 V) / 2 kΩ + v(out) / 4 kΩ = 0" in equations


def test_explain_requires_exactly_one_target(client: TestClient) -> None:
    assert client.post("/api/explain", json={}).status_code == 422
    saved = save(client)
    both = {"netlist": DIVIDER, "circuit_id": saved["id"]}
    assert client.post("/api/explain", json=both).status_code == 422


def test_check_and_history_for_a_saved_circuit(client: TestClient) -> None:
    circuit_id = save(client)["id"]
    client.post("/api/explain", json={"circuit_id": circuit_id})
    body = client.post(
        "/api/check",
        json={
            "circuit_id": circuit_id,
            "answers": {"node_voltages": {"out": 8}, "branch_currents": {"V1": 0.002}},
        },
    ).json()

    assert body["all_correct"] is False
    by_label = {r["label"]: r for r in body["results"]}
    assert by_label["v(out)"]["correct"] is True
    assert by_label["i(V1)"]["correct"] is False and "wrong sign" in by_label["i(V1)"]["hint"]
    assert body["feedback"]["summary"] == "1 of 2 answers are correct."

    history = client.get(f"/api/circuits/{circuit_id}/history").json()
    assert [h["kind"] for h in history] == ["check", "explain"]  # newest first
    assert history[0]["request"]["branch_currents"] == {"V1": 0.002}

    # Deleting the circuit deletes its history (ON DELETE CASCADE).
    client.delete(f"/api/circuits/{circuit_id}")
    assert client.get(f"/api/circuits/{circuit_id}/history").status_code == 404


def test_check_needs_answers(client: TestClient) -> None:
    response = client.post("/api/check", json={"netlist": DIVIDER, "answers": {}})
    assert response.status_code == 422


def test_explain_with_claude_configured(settings: Settings, db: sessionmaker[Session]) -> None:
    output = {
        "summary": "v(out) = 8 V.",
        "steps": [{"title": "KCL", "detail": "2 mA flows.", "equation": None}],
    }
    explainer = Explainer(ClaudeWriter(FakeClaude(claude_message(output)), "claude-opus-5-5"))
    client = make_client(settings, db, explainer)
    assert client.get("/api/health").json()["explanations"] == "claude"
    explanation = client.post("/api/explain", json={"netlist": DIVIDER}).json()["explanation"]
    assert explanation["source"] == "claude" and explanation["summary"] == "v(out) = 8 V."


def test_models_and_migrations_agree(db: sessionmaker[Session]) -> None:
    # Fails if a model changes without a matching Alembic migration.
    command.check(alembic_config())
