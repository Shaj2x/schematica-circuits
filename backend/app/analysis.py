"""Nodal analysis written out the way a student would do it by hand.

The Rust solver returns the answer; this module produces the *working*: which
node voltages a grounded source fixes, which floating sources form
supernodes, and the KCL equation at every remaining node. Those equations
are the backbone of every explanation (template or Claude), and "check my
work" evaluates them with the student's numbers to show where they diverge.

Every equation is checked against the solver's solution in the tests, so the
working and the answer cannot disagree.

DC conventions follow the solver: capacitors are open circuits, inductors are
shorts (0 V sources).
"""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from .units import format_value

#: Terminal field names per component type, in sign-defining order.
TERMINALS: dict[str, tuple[str, str]] = {
    "resistor": ("a", "b"),
    "voltage_source": ("pos", "neg"),
    "current_source": ("from", "to"),
    "capacitor": ("a", "b"),
    "inductor": ("a", "b"),
}

UNITS = {
    "resistor": "Ω",
    "voltage_source": "V",
    "current_source": "A",
    "capacitor": "F",
    "inductor": "H",
}


def terminals(component: Mapping[str, Any]) -> tuple[str, str]:
    first, second = TERMINALS[component["type"]]
    return component[first], component[second]


@dataclass(frozen=True)
class Equation:
    """One line of working.

    - ``fixed``: a node voltage set directly by sources from ground.
    - ``constraint``: v(a) − v(b) fixed by a source inside a supernode.
    - ``kcl``: currents leaving one node sum to zero.
    - ``supernode``: currents leaving a group of nodes joined by sources sum to zero.
    """

    kind: Literal["fixed", "constraint", "kcl", "supernode"]
    nodes: tuple[str, ...]
    text: str
    sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class NodalAnalysis:
    ground: str
    nodes: tuple[str, ...]
    equations: tuple[Equation, ...]
    notes: tuple[str, ...]
    components: tuple[Mapping[str, Any], ...]
    solution: Mapping[str, Any]

    @property
    def node_voltages(self) -> Mapping[str, float]:
        voltages: Mapping[str, float] = self.solution["node_voltages"]
        return voltages

    @property
    def branch_currents(self) -> Mapping[str, float]:
        currents: Mapping[str, float] = self.solution["branch_currents"]
        return currents

    def kcl_residual(self, nodes: tuple[str, ...], voltages: Mapping[str, float]) -> float:
        """Net current leaving a node (or supernode) for the given node voltages.

        Zero when the voltages satisfy KCL there. Voltage sources and
        inductors inside the group cancel (their current enters and leaves
        it), and none cross its boundary by construction.
        """
        inside = set(nodes)

        def v(node: str) -> float:
            return 0.0 if node == self.ground else voltages[node]

        total = 0.0
        for c in self.components:
            a, b = terminals(c)
            if (a in inside) == (b in inside):
                continue
            if c["type"] == "resistor":
                x, y = (a, b) if a in inside else (b, a)
                total += (v(x) - v(y)) / c["value"]
            elif c["type"] == "current_source":
                # The source draws `value` out of `from` and pushes it into `to`.
                total += c["value"] if a in inside else -c["value"]
        return total


def analyze(netlist: Mapping[str, Any], solution: Mapping[str, Any]) -> NodalAnalysis:
    """Builds the nodal-analysis working for a netlist the solver has solved."""
    ground: str = netlist["ground"]
    components: tuple[Mapping[str, Any], ...] = tuple(netlist["components"])
    voltages: Mapping[str, float] = solution["node_voltages"]

    nodes: list[str] = []
    for c in components:
        for n in terminals(c):
            if n != ground and n not in nodes:
                nodes.append(n)

    # Elements that force a voltage difference at DC: voltage sources, and
    # inductors (0 V shorts). They join nodes into groups.
    adjacency: dict[str, list[tuple[str, Mapping[str, Any]]]] = {n: [] for n in [ground, *nodes]}
    for c in components:
        if c["type"] in ("voltage_source", "inductor"):
            a, b = terminals(c)
            adjacency[a].append((b, c))
            adjacency[b].append((a, c))

    equations: list[Equation] = []
    fixed_text: dict[str, str] = {}
    seen: set[str] = set()

    # Nodes reachable from ground through sources: each voltage is fixed.
    for parent, child, c in _bfs_edges(ground, adjacency):
        seen.add(child)
        relation = _relation(parent, child, c, ground)
        fixed_text[child] = format_value(voltages[child], "V")
        # Through another node, also state the resulting value.
        value = "" if parent == ground else f" = {format_value(voltages[child], 'V')}"
        equations.append(Equation("fixed", (child,), f"v({child}) = {relation}{value}", (c["id"],)))
    seen.add(ground)

    for node in nodes:
        if node in seen:
            continue
        group = [node]
        constraints: list[Equation] = []
        for parent, child, c in _bfs_edges(node, adjacency):
            group.append(child)
            constraints.append(
                Equation(
                    "constraint",
                    (parent, child),
                    f"v({child}) = {_relation(parent, child, c, ground)}",
                    (c["id"],),
                )
            )
        seen.update(group)
        kind: Literal["kcl", "supernode"] = "kcl" if len(group) == 1 else "supernode"
        equations.append(Equation(kind, tuple(group), _kcl_text(group, components, ground, fixed_text)))
        equations.extend(constraints)

    notes = []
    for c in components:
        if c["type"] == "capacitor":
            notes.append(f"{c['id']} is a capacitor, an open circuit at DC: no current flows through it.")
        elif c["type"] == "inductor":
            notes.append(
                f"{c['id']} is an inductor, a short circuit at DC: both ends sit at the same voltage."
            )

    return NodalAnalysis(
        ground=ground,
        nodes=tuple(nodes),
        equations=tuple(equations),
        notes=tuple(notes),
        components=components,
        solution=solution,
    )


def _bfs_edges(
    root: str, adjacency: Mapping[str, list[tuple[str, Mapping[str, Any]]]]
) -> list[tuple[str, str, Mapping[str, Any]]]:
    """Tree edges (parent, child, element) of a breadth-first walk from root."""
    visited = {root}
    queue = deque([root])
    edges = []
    while queue:
        parent = queue.popleft()
        for child, c in adjacency[parent]:
            if child not in visited:
                visited.add(child)
                edges.append((parent, child, c))
                queue.append(child)
    return edges


def _relation(parent: str, child: str, c: Mapping[str, Any], ground: str) -> str:
    """v(child) expressed through v(parent) and the element joining them."""
    base = "" if parent == ground else f"v({parent})"
    if c["type"] == "inductor":
        return f"{base or '0 V'} ({c['id']} is a short at DC)"
    volts = c["value"]
    # v(pos) − v(neg) = V, so the pos side is V above the neg side.
    delta = volts if child == c["pos"] else -volts
    if not base:
        return format_value(delta, "V") + f" (set by {c['id']})"
    sign = "+" if delta >= 0 else "−"
    return f"{base} {sign} {format_value(abs(delta), 'V')} ({c['id']})"


def _kcl_text(
    group: list[str],
    components: tuple[Mapping[str, Any], ...],
    ground: str,
    fixed_text: Mapping[str, str],
) -> str:
    """'Currents leaving = 0' written with symbols for unknowns and numbers for knowns."""
    inside = set(group)

    def voltage(n: str) -> str:
        return fixed_text.get(n, f"v({n})")

    terms: list[str] = []
    for c in components:
        a, b = terminals(c)
        if (a in inside) == (b in inside):
            continue
        if c["type"] == "resistor":
            x, y = (a, b) if a in inside else (b, a)
            r = format_value(c["value"], "Ω")
            terms.append(f"{voltage(x)} / {r}" if y == ground else f"({voltage(x)} − {voltage(y)}) / {r}")
        elif c["type"] == "current_source":
            amps = format_value(abs(c["value"]), "A")
            leaving = (a in inside) == (c["value"] >= 0)
            terms.append(f"{'' if leaving else '−'}{amps} ({c['id']})")
    text = terms[0] if terms else "0"
    for term in terms[1:]:
        text += f" − {term[1:]}" if term.startswith("−") else f" + {term}"
    return f"{text} = 0"
