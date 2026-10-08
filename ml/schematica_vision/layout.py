"""Turning traced parts into an editor schematic on the integer grid.

The photo's wires are not copied stroke for stroke: hand-drawn lines snapped
to a grid turn into staircases and accidental contacts. Instead each part is
placed where it was drawn (snapped to the grid), and each net is redrawn as
clean orthogonal wires between its terminals. The drawing looks like the
photo, and the connectivity is exactly what was traced.

That last claim is checked, not assumed. The editor connects anything that
touches (a wire end on another wire, a wire through a terminal), so a careless
route could short two nets. Every candidate route is rejected if it would
touch another net, and the finished schematic is run through `connectivity`,
a port of the editor's connection rules (`frontend/src/schematic/netlist.ts`),
to confirm each terminal ended up on the net it was traced to.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import pairwise
from statistics import median
from typing import Any

Point = tuple[int, int]

PART_LENGTH = 2  # grid units between a part's terminals; matches the editor
GROUND_NODE = "gnd"


@dataclass(frozen=True)
class PartSpec:
    id: str
    kind: str
    value: float
    axis: str  # "horizontal" | "vertical"
    center: tuple[float, float]  # pixels
    length: float  # pixels between terminals
    nets: tuple[int | None, int | None]  # first, second terminal (editor `a`, `b`)


@dataclass(frozen=True)
class GroundSpec:
    id: str
    at: tuple[float, float]  # pixels, the point where its wire attaches
    net: int | None


@dataclass
class Layout:
    schematic: dict[str, Any]
    netlist: dict[str, Any]
    unrouted: list[str] = field(default_factory=list)  # ids of parts whose wiring could not be drawn safely
    scale: float = 1.0  # pixels per grid unit


# ----------------------------------------------------------------------------
# The editor's connection rules, in Python.


def strictly_inside(p: Point, a: Point, b: Point) -> bool:
    cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if cross != 0:
        return False
    dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])
    return 0 < dot < (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2


def _pt(p: dict[str, int]) -> Point:
    return (p["x"], p["y"])


def connectivity(schematic: dict[str, Any]) -> dict[Point, str]:
    """Node name of every connection point, named exactly as `buildNetlist`
    names them: ground is "gnd", the rest n1, n2, ... in reading order of
    each node's top-left point."""
    points: set[Point] = set()
    for part in schematic["parts"]:
        points |= {_pt(part["a"]), _pt(part["b"])}
    for wire in schematic["wires"]:
        points |= {_pt(wire["a"]), _pt(wire["b"])}
    for ground in schematic["grounds"]:
        points.add(_pt(ground["at"]))

    parent = {p: p for p in points}

    def find(p: Point) -> Point:
        while parent[p] != p:
            parent[p] = parent[parent[p]]
            p = parent[p]
        return p

    for wire in schematic["wires"]:
        a, b = _pt(wire["a"]), _pt(wire["b"])
        parent[find(a)] = find(b)
        for p in points:
            if strictly_inside(p, a, b):
                parent[find(p)] = find(a)

    ground_roots = {find(_pt(g["at"])) for g in schematic["grounds"]}
    first: dict[Point, Point] = {}
    for p in points:
        root = find(p)
        if root not in first or (p[1], p[0]) < (first[root][1], first[root][0]):
            first[root] = p
    ordered = sorted((r for r in first if r not in ground_roots), key=lambda r: (first[r][1], first[r][0]))
    names = {root: f"n{i + 1}" for i, root in enumerate(ordered)} | {r: GROUND_NODE for r in ground_roots}
    return {p: names[find(p)] for p in points}


def netlist_of(schematic: dict[str, Any]) -> dict[str, Any]:
    """The netlist the editor derives from this schematic (same as `buildNetlist`)."""
    node = connectivity(schematic)
    terminals = {
        "resistor": ("a", "b"),
        "capacitor": ("a", "b"),
        "inductor": ("a", "b"),
        "voltage_source": ("pos", "neg"),
        "current_source": ("from", "to"),
    }
    components = []
    for part in schematic["parts"]:
        first, second = terminals[part["kind"]]
        component: dict[str, Any] = {
            "id": part["id"],
            "type": part["kind"],
            first: node[_pt(part["a"])],
            second: node[_pt(part["b"])],
            "value": part["value"],
        }
        if part["kind"] == "capacitor":
            component["initial_voltage"] = 0
        elif part["kind"] == "inductor":
            component["initial_current"] = 0
        components.append(component)
    return {"version": 1, "ground": GROUND_NODE, "components": components}


# ----------------------------------------------------------------------------
# Placement.


def _place(parts: list[PartSpec], grounds: list[GroundSpec], scale: float) -> dict[str, Any] | None:
    """Snaps everything to a grid of `scale` pixels per unit, or None if two
    things land on the same point."""
    occupied: dict[Point, str] = {}  # point -> what is there
    placed_parts = []
    for part in parts:
        cx, cy = round(part.center[0] / scale), round(part.center[1] / scale)
        half = PART_LENGTH // 2
        a, b = (
            ((cx - half, cy), (cx + half, cy))
            if part.axis == "horizontal"
            else ((cx, cy - half), (cx, cy + half))
        )
        for p, what in ((a, f"{part.id}.a"), (b, f"{part.id}.b"), ((cx, cy), f"{part.id}.body")):
            if p in occupied:
                return None
            occupied[p] = what
        placed_parts.append((part, a, b))

    placed_grounds = []
    for ground in grounds:
        p = (round(ground.at[0] / scale), round(ground.at[1] / scale))
        if p in occupied:
            return None
        occupied[p] = ground.id
        placed_grounds.append((ground, p))

    return {"parts": placed_parts, "grounds": placed_grounds}


# ----------------------------------------------------------------------------
# Routing.


class _Board:
    """Everything drawn so far, for checking that a new wire touches only its own net."""

    def __init__(self) -> None:
        self.points: dict[Point, int] = {}  # connection point -> net
        self.wires: list[tuple[Point, Point, int]] = []
        self.bodies: list[tuple[Point, Point]] = []

    def conflicts(self, path: list[Point], net: int) -> bool:
        segments = list(pairwise(path))
        for p, owner in self.points.items():
            if owner == net:
                continue
            if any(p in (a, b) or strictly_inside(p, a, b) for a, b in segments):
                return True  # passes through or ends on another net's point
        # A new end or corner on another net's wire would T-join it.
        return any(owner != net and any(strictly_inside(p, a, b) for p in path) for a, b, owner in self.wires)

    def crossings(self, path: list[Point]) -> int:
        """How many part bodies the path runs through. Legal, but hard to read."""
        segments = list(pairwise(path))
        count = 0
        for a, b in self.bodies:
            mid = ((a[0] + b[0]) // 2, (a[1] + b[1]) // 2)
            count += sum(1 for s, t in segments if strictly_inside(mid, s, t) or mid in (s, t))
        return count

    def add(self, path: list[Point], net: int) -> None:
        for p in path:
            self.points[p] = net
        for a, b in pairwise(path):
            self.wires.append((a, b, net))


def _candidates(p: Point, q: Point) -> list[list[Point]]:
    """Orthogonal paths from p to q: straight, the two L shapes, then Z shapes
    with the middle leg shifted, to step around obstacles."""
    (px, py), (qx, qy) = p, q
    if px == qx or py == qy:
        paths = [[p, q]]
        # Detours for a blocked straight run: out one unit, along, back.
        for d in (1, -1, 2, -2):
            if px == qx:
                paths.append([p, (px + d, py), (px + d, qy), q])
            else:
                paths.append([p, (px, py + d), (qx, py + d), q])
        return paths
    paths = [[p, (qx, py), q], [p, (px, qy), q]]
    for x in sorted({(px + qx) // 2, px + 1, px - 1, qx + 1, qx - 1}, key=lambda x: abs(x - (px + qx) / 2)):
        paths.append([p, (x, py), (x, qy), q])
    for y in sorted({(py + qy) // 2, py + 1, py - 1, qy + 1, qy - 1}, key=lambda y: abs(y - (py + qy) / 2)):
        paths.append([p, (px, y), (qx, y), q])
    return [_simplify(path) for path in paths]


def _simplify(path: list[Point]) -> list[Point]:
    """Drops repeated and collinear middle points."""
    out = [path[0]]
    for p in path[1:]:
        if p == out[-1]:
            continue
        if len(out) >= 2 and strictly_inside(out[-1], out[-2], p):
            out[-1] = p
        else:
            out.append(p)
    return out


def _length(path: list[Point]) -> int:
    return sum(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in pairwise(path))


def _spanning_edges(points: list[Point]) -> list[tuple[Point, Point]]:
    """Prim's minimum spanning tree under Manhattan distance."""
    if len(points) < 2:
        return []
    connected, rest, edges = [points[0]], points[1:], []
    while rest:
        a, b = min(
            ((a, b) for a in connected for b in rest),
            key=lambda e: abs(e[0][0] - e[1][0]) + abs(e[0][1] - e[1][1]),
        )
        edges.append((a, b))
        connected.append(b)
        rest.remove(b)
    return edges


def layout(parts: list[PartSpec], grounds: list[GroundSpec]) -> Layout:
    lengths = [p.length for p in parts if p.length > 0]
    base = (median(lengths) if lengths else 80.0) / PART_LENGTH

    # Try progressively finer grids until no two things share a point.
    placed, scale = None, base
    for attempt in range(5):
        scale = base / 2**attempt
        placed = _place(parts, grounds, scale)
        if placed is not None:
            break
    if placed is None:
        raise ValueError("parts overlap too much to place on a grid")

    # Terminals with no wire get a net of their own, so nothing joins them.
    fresh = iter(range(-1, -10_000, -1))
    board = _Board()
    net_points: dict[int, list[Point]] = {}
    owners: dict[int, set[str]] = {}
    schematic_parts = []
    for part, a, b in placed["parts"]:
        nets = tuple(n if n is not None else next(fresh) for n in part.nets)
        for p, n in zip((a, b), nets, strict=True):
            board.points[p] = n
            net_points.setdefault(n, []).append(p)
            owners.setdefault(n, set()).add(part.id)
        board.bodies.append((a, b))
        schematic_parts.append(
            {
                "id": part.id,
                "kind": part.kind,
                "a": {"x": a[0], "y": a[1]},
                "b": {"x": b[0], "y": b[1]},
                "value": part.value,
            }
        )
    schematic_grounds = []
    ground_points: set[Point] = set()
    for ground, p in placed["grounds"]:
        ground_points.add(p)
        n = ground.net if ground.net is not None else next(fresh)
        board.points[p] = n
        net_points.setdefault(n, []).append(p)
        schematic_grounds.append({"id": ground.id, "at": {"x": p[0], "y": p[1]}})

    wires: list[dict[str, Any]] = []
    unrouted: set[str] = set()
    # Big nets first: they have the most constraints and the most to lose.
    for net, points in sorted(net_points.items(), key=lambda kv: -len(kv[1])):
        for p, q in _spanning_edges(points):
            options = [path for path in _candidates(p, q) if not board.conflicts(path, net)]
            if not options:
                unrouted |= owners.get(net, set())
                continue
            path = min(options, key=lambda path: (board.crossings(path), _length(path), len(path)))
            board.add(path, net)
            for s, t in pairwise(path):
                wires.append(
                    {"id": f"W{len(wires) + 1}", "a": {"x": s[0], "y": s[1]}, "b": {"x": t[0], "y": t[1]}}
                )

    schematic = {"parts": schematic_parts, "wires": wires, "grounds": schematic_grounds}

    # Check: every traced net is exactly one node, and no node holds two
    # nets (all grounded nets count as one, since every ground symbol is).
    node = connectivity(schematic)
    grounded = {n for n, points in net_points.items() if any(p in ground_points for p in points)}
    nets_on_node: dict[str, set[int]] = {}
    for n, points in net_points.items():
        names = {node[p] for p in points}
        if len(names) > 1:
            unrouted |= owners.get(n, set())
        for name in names:
            nets_on_node.setdefault(name, set()).add(-1_000_000 if n in grounded else n)
    for name, members in nets_on_node.items():
        if len(members) > 1:
            for n, points in net_points.items():
                if any(node[p] == name for p in points):
                    unrouted |= owners.get(n, set())

    schematic = _at_origin(schematic)
    return Layout(schematic, netlist_of(schematic), sorted(unrouted), scale)


def _at_origin(schematic: dict[str, Any]) -> dict[str, Any]:
    """Shifts everything so the top-left point is (1, 1), where the editor's
    canvas starts. Moving every point alike changes no connection."""
    points = [p for part in schematic["parts"] for p in (part["a"], part["b"])]
    points += [p for wire in schematic["wires"] for p in (wire["a"], wire["b"])]
    points += [g["at"] for g in schematic["grounds"]]
    if not points:
        return schematic
    dx, dy = 1 - min(p["x"] for p in points), 1 - min(p["y"] for p in points)

    def move(p: dict[str, int]) -> dict[str, int]:
        return {"x": p["x"] + dx, "y": p["y"] + dy}

    return {
        "parts": [{**part, "a": move(part["a"]), "b": move(part["b"])} for part in schematic["parts"]],
        "wires": [{**wire, "a": move(wire["a"]), "b": move(wire["b"])} for wire in schematic["wires"]],
        "grounds": [{**g, "at": move(g["at"])} for g in schematic["grounds"]],
    }
