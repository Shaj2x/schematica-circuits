"""Explanations built directly from the nodal-analysis working, no model involved.

This is what runs without an API key, what runs if the Claude call fails,
and a reference point for judging the model's output: every number here
comes straight from the solver.
"""

from __future__ import annotations

from ..analysis import NodalAnalysis, terminals
from ..check import QuantityResult
from ..schemas import Explanation, Step
from ..units import format_value


def explain(analysis: NodalAnalysis) -> Explanation:
    v = analysis.node_voltages
    i = analysis.branch_currents
    steps: list[Step] = []

    unknowns = ", ".join(f"v({n})" for n in analysis.nodes)
    steps.append(
        Step(
            title="Choose ground and label the nodes",
            detail=(
                f"Take {analysis.ground} as the 0 V reference. Every other node gets an unknown "
                f"voltage: {unknowns}."
            ),
        )
    )
    for note in analysis.notes:
        steps.append(Step(title="Simplify for DC", detail=note))

    for eq in analysis.equations:
        if eq.kind == "fixed":
            steps.append(
                Step(
                    title=f"Node {eq.nodes[0]} is fixed by a source",
                    detail=(
                        f"{', '.join(eq.sources)} connects {eq.nodes[0]} to a known voltage, "
                        "so it needs no equation."
                    ),
                    equation=eq.text,
                )
            )
        elif eq.kind == "kcl":
            steps.append(
                Step(
                    title=f"KCL at node {eq.nodes[0]}",
                    detail=(
                        "Write Kirchhoff's current law: the currents leaving the node through each "
                        "branch add up to zero. Each resistor carries (its near-end voltage minus its "
                        "far-end voltage) divided by its resistance."
                    ),
                    equation=eq.text,
                )
            )
        elif eq.kind == "supernode":
            members = " and ".join(eq.nodes)
            steps.append(
                Step(
                    title=f"Supernode around {members}",
                    detail=(
                        f"A voltage source sits between {members}, and its current is unknown. Treat the "
                        "nodes as one supernode: apply KCL to the currents leaving the whole group, "
                        "then add the source's voltage constraint."
                    ),
                    equation=eq.text,
                )
            )
        else:  # constraint
            steps.append(
                Step(
                    title=f"Constraint from {eq.sources[0]}",
                    detail="Inside the supernode, the source fixes the difference between its two ends.",
                    equation=eq.text,
                )
            )

    steps.append(
        Step(
            title="Solve the equations",
            detail="Solving the equations simultaneously gives the node voltages.",
            equation=", ".join(f"v({n}) = {format_value(v[n], 'V')}" for n in analysis.nodes),
        )
    )

    current_lines = []
    for c in analysis.components:
        if c["type"] == "resistor":
            a, b = (n if n != analysis.ground else "0 V" for n in terminals(c))
            va, vb = (n if n == "0 V" else f"v({n})" for n in (a, b))
            resistance = format_value(c["value"], "Ω")
            current = format_value(i[c["id"]], "A")
            current_lines.append(f"i({c['id']}) = ({va} − {vb}) / {resistance} = {current}")
    if current_lines:
        steps.append(
            Step(
                title="Branch currents from Ohm's law",
                detail="A positive current flows from a resistor's first terminal to its second.",
                equation="; ".join(current_lines),
            )
        )

    supplied = sum(
        -(v[terminals(c)[0]] - v[terminals(c)[1]]) * i[c["id"]]
        for c in analysis.components
        if c["type"] in ("voltage_source", "current_source")
    )
    dissipated = sum(
        (v[terminals(c)[0]] - v[terminals(c)[1]]) * i[c["id"]]
        for c in analysis.components
        if c["type"] == "resistor"
    )
    steps.append(
        Step(
            title="Check: power balances",
            detail=(
                f"The sources supply {format_value(supplied, 'W')} in total and the resistors dissipate "
                f"{format_value(dissipated, 'W')}. They match, as conservation of energy requires."
            ),
        )
    )

    return Explanation(
        source="template",
        summary=(
            f"Nodal analysis with {len(analysis.nodes)} unknown node voltage"
            f"{'' if len(analysis.nodes) == 1 else 's'}: "
            + ", ".join(f"v({n}) = {format_value(v[n], 'V')}" for n in analysis.nodes)
            + "."
        ),
        steps=steps,
    )


def feedback(results: list[QuantityResult]) -> Explanation:
    wrong = [r for r in results if not r.correct]
    unit = {"voltage": "V", "current": "A"}
    if not wrong:
        summary = f"All {len(results)} of your answers are correct."
    else:
        summary = f"{len(results) - len(wrong)} of {len(results)} answers are correct."
    steps = [
        Step(
            title=f"{r.label}: you wrote {format_value(r.submitted, unit[r.kind])}",
            detail=(r.hint or "This does not match the solution. Recheck how you set up this quantity.")
            + (
                f" The correct value is {format_value(r.expected, unit[r.kind])}."
                if r.expected is not None
                else ""
            ),
        )
        for r in wrong
    ]
    return Explanation(source="template", summary=summary, steps=steps)
