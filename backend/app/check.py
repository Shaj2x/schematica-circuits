"""'Check my work': compare a student's answers with the solution and say
where, and probably why, they diverged.

The comparison and the diagnosis are deterministic. An LLM (when configured)
only rewords them into friendlier feedback, so a wrong hint can never come
from the model inventing a number.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from .analysis import NodalAnalysis, terminals
from .units import format_value

Kind = Literal["voltage", "current"]

#: Relative tolerance for "correct": answers rounded to 3 significant figures pass.
RELATIVE_TOLERANCE = 0.01


@dataclass(frozen=True)
class QuantityResult:
    kind: Kind
    name: str
    label: str  # "v(n2)" or "i(R1)"
    submitted: float
    expected: float | None  # None when the node or component does not exist
    correct: bool
    hint: str | None


def check_answers(
    analysis: NodalAnalysis,
    node_voltages: Mapping[str, float],
    branch_currents: Mapping[str, float],
) -> list[QuantityResult]:
    results = [
        _check(analysis, "voltage", name, value, analysis.node_voltages)
        for name, value in node_voltages.items()
    ]
    results += [
        _check(analysis, "current", name, value, analysis.branch_currents)
        for name, value in branch_currents.items()
    ]
    # Second pass: for wrong voltages without a specific hint, show which KCL
    # equation the student's own numbers violate.
    student = {**analysis.node_voltages, **node_voltages}
    return [_with_kcl_hint(analysis, r, student) if not r.correct and r.hint is None else r for r in results]


def _check(
    analysis: NodalAnalysis,
    kind: Kind,
    name: str,
    submitted: float,
    expected_values: Mapping[str, float],
) -> QuantityResult:
    label = f"v({name})" if kind == "voltage" else f"i({name})"
    expected = expected_values.get(name)
    if expected is None:
        what = "node" if kind == "voltage" else "component"
        return QuantityResult(kind, name, label, submitted, None, False, f"There is no {what} called {name}.")
    scale = max((abs(v) for v in expected_values.values()), default=0.0)
    tolerance = _tolerance(expected, scale)
    correct = abs(submitted - expected) <= tolerance
    hint = None if correct else _diagnose(analysis, kind, name, submitted, expected, tolerance)
    return QuantityResult(kind, name, label, submitted, expected, correct, hint)


def _tolerance(expected: float, scale: float) -> float:
    # Relative to the value, with a floor relative to the circuit's scale so
    # that a value that should be ~0 isn't held to an impossible standard.
    return max(RELATIVE_TOLERANCE * abs(expected), 1e-4 * scale, 1e-12)


def _close(a: float, b: float, tolerance: float) -> bool:
    return abs(a - b) <= tolerance


def _diagnose(
    analysis: NodalAnalysis,
    kind: Kind,
    name: str,
    submitted: float,
    expected: float,
    tolerance: float,
) -> str | None:
    """Recognizes the common mistakes; None when none fits."""
    if expected != 0 and _close(submitted, -expected, tolerance):
        if kind == "current":
            return (
                "Right size, wrong sign. A positive current flows from the component's first "
                "terminal to its second (+ to − through a voltage source); check which way you "
                "assumed it flows."
            )
        return "Right size, wrong sign. Node voltages are measured from ground: check which end is ground."

    if expected != 0 and submitted != 0:
        ratio = submitted / expected
        exponent = round(math.log10(abs(ratio)) / 3) * 3 if ratio > 0 else 0
        if exponent != 0 and _close(ratio, 10.0**exponent, 0.01 * 10.0**exponent):
            return (
                f"Off by a factor of 10^{exponent}: check your unit prefixes "
                "(for example mA vs A, or kΩ vs Ω)."
            )

    if kind == "voltage":
        v = analysis.node_voltages
        for c in analysis.components:
            a, b = terminals(c)
            if name not in (a, b):
                continue
            other = b if a == name else a
            across = v[name] - v[other]
            if other != analysis.ground and _close(submitted, across, tolerance):
                return (
                    f"That is the voltage across {c['id']} (from {name} to {other}), not the voltage "
                    f"of {name} relative to ground."
                )
    else:
        for other_id, current in analysis.branch_currents.items():
            if (
                other_id != name
                and _close(abs(submitted), abs(current), tolerance)
                and abs(current) > tolerance
            ):
                return f"That is the current through {other_id}, not {name}."
    return None


def _with_kcl_hint(
    analysis: NodalAnalysis, result: QuantityResult, student: Mapping[str, float]
) -> QuantityResult:
    if result.kind != "voltage" or result.expected is None:
        return result
    for equation in analysis.equations:
        if equation.kind in ("kcl", "supernode") and result.name in equation.nodes:
            residual = analysis.kcl_residual(equation.nodes, student)
            where = (
                f"node {equation.nodes[0]}"
                if equation.kind == "kcl"
                else "the supernode " + "+".join(equation.nodes)
            )
            hint = (
                f"With your values, KCL at {where} does not balance: the currents leaving add up to "
                f"{format_value(residual, 'A')} instead of 0. Recheck that equation: "
                f"{equation.text}."
            )
            return QuantityResult(**{**result.__dict__, "hint": hint})
        if equation.kind in ("fixed", "constraint") and equation.nodes[-1] == result.name:
            hint = f"This node's voltage is set directly by a source: {equation.text}."
            return QuantityResult(**{**result.__dict__, "hint": hint})
    return result


def results_as_dicts(results: list[QuantityResult]) -> list[dict[str, Any]]:
    return [r.__dict__ for r in results]
