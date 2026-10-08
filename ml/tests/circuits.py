"""Test circuits in the editor's schematic format (grid units)."""

from __future__ import annotations

from itertools import pairwise
from typing import Any


def P(x: int, y: int) -> dict[str, int]:
    return {"x": x, "y": y}


def part(id: str, kind: str, a: tuple[int, int], b: tuple[int, int], value: float) -> dict[str, Any]:
    return {"id": id, "kind": kind, "a": P(*a), "b": P(*b), "value": value}


def wires(*points: tuple[int, int]) -> list[dict[str, Any]]:
    return [{"id": "", "a": P(*p), "b": P(*q)} for p, q in pairwise(points)]


def numbered(schematic: dict[str, Any]) -> dict[str, Any]:
    for i, wire in enumerate(schematic["wires"]):
        wire["id"] = f"W{i + 1}"
    return schematic


# V1 feeding R1 in series with R2 to ground; ground on the bottom rail.
DIVIDER = numbered(
    {
        "parts": [
            part("V1", "voltage_source", (0, 1), (0, 3), 10),
            part("R1", "resistor", (1, 0), (3, 0), 1000),
            part("R2", "resistor", (4, 1), (4, 3), 2200),
        ],
        "wires": [
            *wires((0, 1), (0, 0), (1, 0)),
            *wires((3, 0), (4, 0), (4, 1)),
            *wires((0, 3), (0, 4), (4, 4), (4, 3)),
        ],
        "grounds": [{"id": "G1", "at": P(2, 4)}],
    }
)

# A current source driving R1, and an L1-C1 branch, in parallel. Has a
# three-way junction at (3, 0) and a T-junction into the bottom rail.
LADDER = numbered(
    {
        "parts": [
            part("I1", "current_source", (0, 3), (0, 1), 0.002),
            part("R1", "resistor", (3, 1), (3, 3), 4700),
            part("L1", "inductor", (4, 0), (6, 0), 0.01),
            part("C1", "capacitor", (7, 1), (7, 3), 1e-7),
        ],
        "wires": [
            *wires((0, 1), (0, 0), (3, 0), (3, 1)),
            *wires((3, 0), (4, 0)),
            *wires((6, 0), (7, 0), (7, 1)),
            *wires((0, 3), (0, 4), (7, 4), (7, 3)),
            *wires((3, 3), (3, 4)),
        ],
        "grounds": [{"id": "G1", "at": P(0, 4)}],
    }
)

# Two loops sharing R2: a Wheatstone-style bridge without the bridge.
TWO_LOOPS = numbered(
    {
        "parts": [
            part("V1", "voltage_source", (0, 1), (0, 3), 5),
            part("R1", "resistor", (1, 0), (3, 0), 330),
            part("R2", "resistor", (4, 1), (4, 3), 680),
            part("R3", "resistor", (5, 0), (7, 0), 1500),
            part("R4", "resistor", (8, 1), (8, 3), 3300),
        ],
        "wires": [
            *wires((0, 1), (0, 0), (1, 0)),
            *wires((3, 0), (4, 0), (5, 0)),
            *wires((4, 0), (4, 1)),
            *wires((7, 0), (8, 0), (8, 1)),
            *wires((0, 3), (0, 4), (8, 4), (8, 3)),
            *wires((4, 3), (4, 4)),
        ],
        "grounds": [{"id": "G1", "at": P(6, 4)}],
    }
)

ALL = {"divider": DIVIDER, "ladder": LADDER, "two_loops": TWO_LOOPS}
