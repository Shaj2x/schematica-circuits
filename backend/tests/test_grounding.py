"""The grounding check flags numbers that match nothing in the circuit."""

from __future__ import annotations

import pytest
import schematica_solver

from app.analysis import analyze
from app.grounding import unverified_numbers
from app.units import find_quantities, format_value

from .conftest import fixture


def divider_analysis():  # type: ignore[no-untyped-def]
    netlist = fixture("voltage_divider_unequal")["netlist"]  # 12 V, 2 kΩ, 4 kΩ -> 8 V, 2 mA
    return analyze(netlist, schematica_solver.solve(netlist))


def test_values_from_the_circuit_pass() -> None:
    text = (
        "v(out) = 8 V, so 4 V drops across R1 and 2 mA flows. The resistors add to 6 kΩ, "
        "and R2 dissipates 16 mW of the 24 mW the source delivers. 12 V is the supply."
    )
    assert unverified_numbers([text], divider_analysis()) == []


def test_invented_values_are_flagged() -> None:
    text = "So v(out) = 7.5 V and the current is 2.4 mA through 2 kΩ."
    assert unverified_numbers([text], divider_analysis()) == ["7.5 V", "2.4 mA"]


def test_rounding_to_three_significant_figures_is_accepted() -> None:
    netlist = fixture("wheatstone_unbalanced")["netlist"]  # v(a) = 40/7 V
    analysis = analyze(netlist, schematica_solver.solve(netlist))
    assert unverified_numbers(["v(a) = 5.71 V"], analysis) == []


def test_find_quantities() -> None:
    found = find_quantities("4.7 kΩ, 3.33mA, −5 V, 2.2 MΩ, 10 µA, 1e-3 W, step 2")
    expected = [(4700.0, "Ω"), (0.00333, "A"), (-5.0, "V"), (2.2e6, "Ω"), (1e-5, "A"), (1e-3, "W")]
    assert [q.unit for q in found] == [unit for _, unit in expected]
    assert [q.value for q in found] == pytest.approx([value for value, _ in expected])


def test_format_value() -> None:
    assert format_value(4700, "Ω") == "4.7 kΩ"
    assert format_value(0.0033333, "A") == "3.33 mA"
    assert format_value(-0.002, "A") == "-2 mA"
    assert format_value(0, "V") == "0 V"
