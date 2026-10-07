"""The Python binding returns exactly what the Rust solver computes."""

from __future__ import annotations

import pytest
import schematica_solver

from .conftest import FIXTURES, fixture


@pytest.mark.parametrize("name", sorted(p.stem for p in FIXTURES.glob("*.json")))
def test_fixture_matches_hand_derivation(name: str) -> None:
    data = fixture(name)
    solution = schematica_solver.solve(data["netlist"])
    for node, expected in data["expected"]["node_voltages"].items():
        assert solution["node_voltages"][node] == pytest.approx(expected, rel=1e-9, abs=1e-12)
    for component, expected in data["expected"]["branch_currents"].items():
        assert solution["branch_currents"][component] == pytest.approx(expected, rel=1e-9, abs=1e-12)


def test_errors_are_raised_with_structured_detail() -> None:
    netlist = {
        "version": 1,
        "ground": "gnd",
        "components": [
            {"id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 1},
            {"id": "R2", "type": "resistor", "a": "x", "b": "y", "value": 1},
        ],
    }
    with pytest.raises(schematica_solver.SolverError) as raised:
        schematica_solver.solve(netlist)
    assert raised.value.kind == "floating_nodes"
    assert raised.value.detail["nodes"] == ["x", "y"]
    assert "no path to ground" in str(raised.value)


def test_transient() -> None:
    netlist = {
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
    out = schematica_solver.solve_transient(netlist, {"stop_time": 1e-3, "time_step": 1e-6})
    assert len(out["time"]) == 1001
    assert out["node_voltages"]["a"][-1] == pytest.approx(0.36787944, rel=1e-6)
