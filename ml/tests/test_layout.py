import json
import os
from pathlib import Path

import pytest
from circuits import ALL, P, part, wires
from netlists import assert_equivalent

from schematica_vision.layout import GroundSpec, PartSpec, connectivity, layout, netlist_of


def test_connection_rules_match_the_editor() -> None:
    schematic = {
        "parts": [part("R1", "resistor", (0, 0), (2, 0), 1), part("R2", "resistor", (4, -2), (4, 0), 2)],
        "wires": [
            *wires((2, 0), (6, 0)),  # passes through R2's terminal at (4, 0): connected
            *wires((5, -1), (5, 1)),  # crosses the first wire mid-span: not connected
            *wires((0, 2), (3, 2)),
            *wires((3, 2), (3, 0)),  # ends on the first wire's interior: T-junction
        ],
        "grounds": [{"id": "G1", "at": P(0, 0)}],
    }
    node = connectivity(schematic)
    assert node[(2, 0)] == node[(4, 0)] == node[(3, 0)] == node[(6, 0)]
    assert node[(5, -1)] != node[(2, 0)]
    assert node[(0, 0)] == "gnd"
    assert node[(4, -2)] == "n1"  # reading order: topmost first


def specs_from(schematic: dict) -> tuple[list[PartSpec], list[GroundSpec]]:
    """Layout input from a known schematic: nets taken from its connectivity."""
    node = connectivity(schematic)
    ids = {name: i for i, name in enumerate(sorted(set(node.values())))}
    unit = 50.0
    specs = []
    for p in schematic["parts"]:
        a, b = (p["a"]["x"], p["a"]["y"]), (p["b"]["x"], p["b"]["y"])
        specs.append(
            PartSpec(
                p["id"],
                p["kind"],
                p["value"],
                "horizontal" if a[1] == b[1] else "vertical",
                ((a[0] + b[0]) / 2 * unit, (a[1] + b[1]) / 2 * unit),
                2 * unit,
                (ids[node[a]], ids[node[b]]),
            )
        )
    grounds = [
        GroundSpec(
            g["id"], (g["at"]["x"] * unit, g["at"]["y"] * unit), ids[node[(g["at"]["x"], g["at"]["y"])]]
        )
        for g in schematic["grounds"]
    ]
    return specs, grounds


@pytest.mark.parametrize("name", sorted(ALL))
def test_layout_reproduces_connectivity(name: str) -> None:
    specs, grounds = specs_from(ALL[name])
    result = layout(specs, grounds)
    assert result.unrouted == []
    assert_equivalent(result.netlist, netlist_of(ALL[name]))


def test_routes_around_other_nets() -> None:
    # Three resistors in a row with R1 and R3 on one net and R2 between them
    # on another: the straight route from R1 to R3 would run through R2's
    # terminals, so the router must detour.
    specs = [
        PartSpec("R1", "resistor", 1, "vertical", (0, 50), 100, (1, 2)),
        PartSpec("R2", "resistor", 2, "vertical", (100, 50), 100, (3, 4)),
        PartSpec("R3", "resistor", 3, "vertical", (200, 50), 100, (1, 5)),
    ]
    result = layout(specs, [])
    assert result.unrouted == []
    node = connectivity(result.schematic)
    parts = {p["id"]: p for p in result.schematic["parts"]}
    top = lambda i: (parts[i]["a"]["x"], parts[i]["a"]["y"])  # noqa: E731
    assert node[top("R1")] == node[top("R3")] != node[top("R2")]


def test_unconnected_terminals_stay_unconnected() -> None:
    specs = [PartSpec("R1", "resistor", 1, "horizontal", (50, 0), 100, (None, None))]
    result = layout(specs, [])
    assert result.schematic["wires"] == []
    (component,) = result.netlist["components"]
    assert component["a"] != component["b"]


GOLDEN = Path(__file__).parents[2] / "frontend/src/schematic/recognized.fixture.json"


def test_golden_fixture_for_the_frontend() -> None:
    """The frontend checks that its own `buildNetlist` derives exactly this
    netlist from this schematic, which keeps the two implementations of the
    connection rules in step. Regenerate with UPDATE_GOLDEN=1."""
    fixtures = {}
    for name in sorted(ALL):
        result = layout(*specs_from(ALL[name]))
        fixtures[name] = {"schematic": result.schematic, "netlist": result.netlist}
    text = json.dumps(fixtures, indent=1) + "\n"
    if os.environ.get("UPDATE_GOLDEN"):
        GOLDEN.write_text(text)
    assert GOLDEN.read_text() == text
