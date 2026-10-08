"""The photo endpoint, with a detector that returns known boxes.

The real model is not needed: the endpoint's job is upload handling, errors
and the response shape. The pipeline itself is tested in ml/tests.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import pytest
import schematica_solver
from fastapi.testclient import TestClient
from schematica_vision.synthetic import GroundTruthDetector, GroundTruthReader, render
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.explain import Explainer
from app.recognition import Recognizer, make_recognizer

from .conftest import make_client


def P(x: int, y: int) -> dict[str, int]:
    return {"x": x, "y": y}


DIVIDER = {
    "parts": [
        {"id": "V1", "kind": "voltage_source", "a": P(0, 1), "b": P(0, 3), "value": 9},
        {"id": "R1", "kind": "resistor", "a": P(1, 0), "b": P(3, 0), "value": 1000},
        {"id": "R2", "kind": "resistor", "a": P(4, 1), "b": P(4, 3), "value": 2000},
    ],
    "wires": [
        {"id": f"W{i}", "a": P(*a), "b": P(*b)}
        for i, (a, b) in enumerate(
            [
                ((0, 1), (0, 0)),
                ((0, 0), (1, 0)),
                ((3, 0), (4, 0)),
                ((4, 0), (4, 1)),
                ((0, 3), (0, 4)),
                ((0, 4), (4, 4)),
                ((4, 4), (4, 3)),
            ]
        )
    ],
    "grounds": [{"id": "G1", "at": P(2, 4)}],
}


@pytest.fixture
def photo() -> tuple[bytes, Recognizer]:
    rendering = render(DIVIDER)
    _, png = cv2.imencode(".png", rendering.image)
    return png.tobytes(), Recognizer(GroundTruthDetector(rendering), GroundTruthReader(rendering))


def upload(client: TestClient, data: bytes, content_type: str = "image/png") -> Any:
    return client.post("/api/recognize", files={"image": ("circuit.png", data, content_type)})


def test_recognizes_a_photo_into_a_solvable_circuit(
    settings: Settings, db: sessionmaker[Session], photo: tuple[bytes, Recognizer]
) -> None:
    data, recognizer = photo
    client = make_client(settings, db, Explainer(), recognizer)
    assert client.get("/api/health").json()["recognition"] is True

    response = upload(client, data)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["schematic"]["parts"]) == 3
    assert {d["value_text"] for d in body["detections"] if d["part_id"]} == {"9V", "1k", "2k"}
    assert [w["code"] for w in body["warnings"]] == ["polarity"]
    # The recognized circuit solves: 9 V across 1k + 2k leaves 6 V on R2.
    solution = schematica_solver.solve(body["netlist"])
    r2 = next(c for c in body["netlist"]["components"] if c["value"] == 2000)
    assert solution["node_voltages"][r2["a"]] == pytest.approx(6.0)


def test_without_a_model_the_endpoint_says_so(client: TestClient, photo: tuple[bytes, Recognizer]) -> None:
    response = upload(client, photo[0])
    assert response.status_code == 503
    assert "no trained model" in response.json()["detail"]


def test_rejects_bad_uploads(
    settings: Settings, db: sessionmaker[Session], photo: tuple[bytes, Recognizer]
) -> None:
    data, recognizer = photo
    client = make_client(settings, db, Explainer(), recognizer)
    assert upload(client, data, "application/pdf").status_code == 415
    assert upload(client, b"definitely not a png").status_code == 422

    small = make_client(settings.model_copy(update={"max_upload_bytes": 100}), db, Explainer(), recognizer)
    assert upload(small, data).status_code == 413


def test_missing_model_file_disables_recognition(settings: Settings, tmp_path: Path) -> None:
    recognizer = make_recognizer(settings.model_copy(update={"model_path": tmp_path / "missing.onnx"}))
    assert not recognizer.available
