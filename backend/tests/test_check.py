"""Check my work: correct answers pass, common mistakes get specific hints."""

from __future__ import annotations

import schematica_solver

from app.analysis import NodalAnalysis, analyze
from app.check import check_answers

from .conftest import fixture


def divider() -> NodalAnalysis:
    # 12 V across 2 kΩ over 4 kΩ: v(out) = 8 V, i = 2 mA, V1 reports −2 mA.
    netlist = fixture("voltage_divider_unequal")["netlist"]
    return analyze(netlist, schematica_solver.solve(netlist))


def one(analysis: NodalAnalysis, **answers: float) -> str | None:
    voltages = {k[2:]: v for k, v in answers.items() if k.startswith("v_")}
    currents = {k[2:]: v for k, v in answers.items() if k.startswith("i_")}
    [result] = check_answers(analysis, voltages, currents)
    assert not result.correct
    return result.hint


def test_correct_answers_pass_including_rounding() -> None:
    results = check_answers(divider(), {"out": 8.0, "in": 12}, {"R1": 0.002, "V1": -0.002})
    assert all(r.correct for r in results)
    # 3 significant figures is enough: 6.67 V for 20/3 V.
    netlist = fixture("wheatstone_unbalanced")["netlist"]
    bridge = analyze(netlist, schematica_solver.solve(netlist))
    assert all(r.correct for r in check_answers(bridge, {"a": 5.71, "b": 4.29}, {"R5": 1.43e-3}))


def test_sign_error_on_a_source_current() -> None:
    hint = one(divider(), i_V1=0.002)
    assert hint is not None and "wrong sign" in hint and "first terminal" in hint


def test_unit_prefix_error() -> None:
    hint = one(divider(), i_R1=2.0)  # wrote 2 A for 2 mA
    assert hint is not None and "factor of 10^3" in hint


def test_voltage_across_a_component_instead_of_to_ground() -> None:
    hint = one(divider(), v_out=-4.0)  # v(out) − v(in) = −4 V
    assert hint is not None and "voltage across R1" in hint


def test_current_of_another_component() -> None:
    netlist = fixture("series_parallel")["netlist"]  # R1 4.5 mA, R2 = R3 = 2.25 mA
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    hint = one(analysis, i_R2=0.0045)
    assert hint == "That is the current through R1, not R2."


def test_otherwise_points_at_the_violated_kcl_equation() -> None:
    hint = one(divider(), v_out=7.0)
    assert hint is not None
    assert "KCL at node out does not balance" in hint
    # With v(out) = 7 V: (7 − 12)/2k + 7/4k = −0.75 mA.
    assert "-750 µA" in hint
    assert "(v(out) − 12 V) / 2 kΩ + v(out) / 4 kΩ = 0" in hint


def test_node_fixed_by_a_source() -> None:
    hint = one(divider(), v_in=10.0)
    assert hint is not None and "set directly by a source" in hint


def test_unknown_names() -> None:
    [result] = check_answers(divider(), {"nope": 1.0}, {})
    assert result.expected is None and result.hint == "There is no node called nope."
