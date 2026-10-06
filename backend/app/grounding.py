"""Grounding check: does every number in an explanation come from the circuit?

A language model can write a plausible but wrong value ("so v(n2) = 6.5 V").
After generation, every value-with-unit in the text is compared with the
quantities the solver and the netlist actually contain. Anything without a
match is returned as unverified, so the UI can flag it instead of presenting
it as fact.

Known limitations: numbers without units are ignored, and a correct
intermediate the model computed in a way not listed here (say, three
resistors in parallel) is reported as unverified. Both err on the side of
flagging, which is the safe direction.
"""

from __future__ import annotations

from collections.abc import Iterable
from itertools import combinations

from .analysis import NodalAnalysis, terminals
from .units import find_quantities

#: Matches survive rounding to 3 significant figures (worst case 0.5%).
RELATIVE_TOLERANCE = 0.01


def known_quantities(analysis: NodalAnalysis) -> dict[str, list[float]]:
    v = analysis.node_voltages
    i = analysis.branch_currents
    resistances = [c["value"] for c in analysis.components if c["type"] == "resistor"]

    volts = [*v.values(), *(a - b for a, b in combinations(v.values(), 2))]
    volts += [c["value"] for c in analysis.components if c["type"] == "voltage_source"]
    amps = [*i.values()] + [c["value"] for c in analysis.components if c["type"] == "current_source"]
    # Series and parallel pairs are the combinations students (and models)
    # write most often.
    ohms = resistances + [a + b for a, b in combinations(resistances, 2)]
    ohms += [a * b / (a + b) for a, b in combinations(resistances, 2)]
    absorbed: dict[str, float] = {}
    for c in analysis.components:
        a, b = terminals(c)
        absorbed[c["id"]] = (v[a] - v[b]) * i[c["id"]]
    watts = list(absorbed.values())
    # Totals: all power absorbed, power dissipated in resistors, and net
    # power delivered by the sources (equal to the resistor total).
    watts.append(sum(w for w in watts if w > 0))
    watts.append(sum(absorbed[c["id"]] for c in analysis.components if c["type"] == "resistor"))
    watts.append(-sum(w for w in absorbed.values() if w < 0))
    return {"V": volts, "A": amps, "Ω": ohms, "W": watts}


def unverified_numbers(texts: Iterable[str], analysis: NodalAnalysis) -> list[str]:
    known = known_quantities(analysis)
    scale = {unit: max((abs(x) for x in xs), default=0.0) for unit, xs in known.items()}
    flagged: list[str] = []
    for text in texts:
        for q in find_quantities(text):
            candidates = known.get(q.unit, [])
            floor = 1e-9 * scale.get(q.unit, 0.0) + 1e-15
            if (
                not any(
                    abs(abs(q.value) - abs(k)) <= max(RELATIVE_TOLERANCE * abs(k), floor) for k in candidates
                )
                and q.text not in flagged
            ):
                flagged.append(q.text)
    return flagged
