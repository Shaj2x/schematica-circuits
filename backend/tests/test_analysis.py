"""The written-out working must agree with the solver's answer."""

from __future__ import annotations

import pytest
import schematica_solver

from app.analysis import analyze

from .conftest import FIXTURES, fixture


@pytest.mark.parametrize("name", sorted(p.stem for p in FIXTURES.glob("*.json")))
def test_solution_satisfies_every_kcl_equation(name: str) -> None:
    netlist = fixture(name)["netlist"]
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    scale = max(abs(i) for i in analysis.branch_currents.values())
    kcl = [e for e in analysis.equations if e.kind in ("kcl", "supernode")]
    for equation in kcl:
        assert abs(analysis.kcl_residual(equation.nodes, analysis.node_voltages)) < 1e-9 * scale
    # One equation per unknown: fixed nodes, constraints and KCL together
    # cover every non-ground node exactly once.
    covered = [n for e in analysis.equations if e.kind == "fixed" for n in e.nodes]
    covered += [n for e in kcl for n in e.nodes]
    assert sorted(covered) == sorted(analysis.nodes)


def test_divider_working() -> None:
    netlist = fixture("voltage_divider_unequal")["netlist"]
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    assert [(e.kind, e.text) for e in analysis.equations] == [
        ("fixed", "v(in) = 12 V (set by V1)"),
        ("kcl", "(v(out) − 12 V) / 2 kΩ + v(out) / 4 kΩ = 0"),
    ]


def test_floating_source_becomes_a_supernode() -> None:
    netlist = fixture("floating_voltage_source")["netlist"]
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    kinds = [(e.kind, e.nodes) for e in analysis.equations]
    assert kinds == [("fixed", ("a",)), ("supernode", ("b", "c")), ("constraint", ("b", "c"))]
    assert analysis.equations[2].text == "v(c) = v(b) − 3 V (V2)"


def test_current_sources_appear_with_their_direction() -> None:
    netlist = fixture("mixed_sources")["netlist"]
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    # I1 pushes 1 A into b, so it enters KCL at b as −1 A (currents leaving).
    assert analysis.equations[1].text == "(v(b) − 12 V) / 4 Ω + v(b) / 6 Ω − 1 A (I1) = 0"


def test_dc_notes_for_reactive_parts() -> None:
    netlist = {
        "version": 1,
        "ground": "gnd",
        "components": [
            {"id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 12},
            {"id": "R1", "type": "resistor", "a": "in", "b": "a", "value": 1000},
            {"id": "C1", "type": "capacitor", "a": "a", "b": "gnd", "value": 1e-6},
            {"id": "L1", "type": "inductor", "a": "a", "b": "b", "value": 1e-3},
            {"id": "R2", "type": "resistor", "a": "b", "b": "gnd", "value": 2000},
        ],
    }
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    assert any("C1" in n and "open circuit" in n for n in analysis.notes)
    assert any("L1" in n and "short circuit" in n for n in analysis.notes)
    # L1 joins a and b into one supernode at DC.
    supernode = next(e for e in analysis.equations if e.kind == "supernode")
    assert set(supernode.nodes) == {"a", "b"}
