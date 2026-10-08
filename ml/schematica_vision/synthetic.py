"""Rendering editor schematics as images, with ground-truth labels.

Used two ways:

* Tests. Render a circuit whose netlist we know, run the pipeline with a
  detector that returns the true boxes, and check the recovered netlist
  matches. That tests wire tracing, value assignment and layout without a
  trained model, so it runs anywhere in milliseconds.
* A smoke-test dataset for `training/train.py --synthetic`, so the training
  and export path can be checked end to end without downloading CGHD.

The drawings are deliberately imperfect (jittered strokes, slightly short
wires) so tests exercise gap closing rather than pixel-perfect lines.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import cv2
import numpy as np

from .image import Image
from .types import Box, Detection

UNIT_SYMBOLS = {
    "resistor": "",
    "capacitor": "F",
    "inductor": "H",
    "voltage_source": "V",
    "current_source": "A",
}


@dataclass
class Rendering:
    image: Image
    detections: list[Detection]  # ground truth, confidence 1
    texts: dict[tuple[int, int, int, int], str]  # rounded text box -> its text
    sources: dict[int, str]  # index into detections -> id of the part drawn there


def format_value(value: float, unit: str) -> str:
    for scale, prefix in ((1e6, "M"), (1e3, "k"), (1, ""), (1e-3, "m"), (1e-6, "u"), (1e-9, "n")):
        if abs(value) >= scale * 0.999:
            number = f"{value / scale:g}"
            return f"{number}{prefix}{unit}"
    return f"{value:g}{unit}"


class _Pen:
    def __init__(self, image: Image, rng: random.Random, thickness: int, jitter: float) -> None:
        self.image, self.rng, self.thickness, self.jitter = image, rng, thickness, jitter

    def _j(self, p: tuple[float, float]) -> tuple[int, int]:
        return (
            round(p[0] + self.rng.uniform(-self.jitter, self.jitter)),
            round(p[1] + self.rng.uniform(-self.jitter, self.jitter)),
        )

    def line(self, p: tuple[float, float], q: tuple[float, float]) -> None:
        cv2.line(self.image, self._j(p), self._j(q), (20, 20, 20), self.thickness, cv2.LINE_AA)

    def polyline(self, points: list[tuple[float, float]]) -> None:
        for p, q in pairwise(points):
            self.line(p, q)

    def circle(self, c: tuple[float, float], r: float, filled: bool = False) -> None:
        cv2.circle(
            self.image, self._j(c), round(r), (20, 20, 20), -1 if filled else self.thickness, cv2.LINE_AA
        )


def _symbol(pen: _Pen, kind: str, a: tuple[float, float], b: tuple[float, float], body: float) -> Box:
    """Draws a two-terminal symbol from a to b; returns the body's box."""
    (ax, ay), (bx, by) = a, b
    length = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length  # along
    nx, ny = -uy, ux  # across
    cx, cy = (ax + bx) / 2, (ay + by) / 2
    half = body / 2

    def at(s: float, t: float) -> tuple[float, float]:
        return (cx + ux * s + nx * t, cy + uy * s + ny * t)

    pen.line(a, at(-half, 0))
    pen.line(at(half, 0), b)
    width = body * 0.28
    if kind == "resistor":
        zig = (
            [at(-half, 0)]
            + [at(-half + body * (i + 0.5) / 6, width * (1 if i % 2 else -1)) for i in range(6)]
            + [at(half, 0)]
        )
        pen.polyline(zig)
    elif kind == "capacitor":
        gap = body * 0.12
        pen.line(at(-half, 0), at(-gap, 0))
        pen.line(at(gap, 0), at(half, 0))
        pen.line(at(-gap, -width * 1.6), at(-gap, width * 1.6))
        pen.line(at(gap, -width * 1.6), at(gap, width * 1.6))
        width *= 1.6
    elif kind == "inductor":
        humps = 4
        points = []
        for i in range(humps * 8 + 1):
            s = -half + body * i / (humps * 8)
            phase = (i % 8) / 8 * math.pi
            points.append(at(s, -abs(math.sin(phase)) * width))
        pen.polyline(points)
    else:
        r = half
        pen.circle((cx, cy), r)
        width = r
        if kind == "voltage_source":
            # "+" towards a, "-" towards b.
            m = r * 0.18
            for s, plus in ((-r * 0.5, True), (r * 0.5, False)):
                pen.line(at(s, -m), at(s, m))
                if plus:
                    pen.line(at(s - m, 0), at(s + m, 0))
        else:
            # Arrow from a to b.
            pen.line(at(-r * 0.6, 0), at(r * 0.6, 0))
            pen.line(at(r * 0.6, 0), at(r * 0.25, r * 0.3))
            pen.line(at(r * 0.6, 0), at(r * 0.25, -r * 0.3))

    corners = [at(s, t) for s in (-half, half) for t in (-width, width)]
    xs, ys = [p[0] for p in corners], [p[1] for p in corners]
    pad = pen.thickness + 2
    return Box(min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def render(
    schematic: dict[str, Any],
    unit: float = 60.0,
    seed: int = 0,
    jitter: float = 1.0,
    wire_gap: float = 3.0,
    labels: bool = True,
) -> Rendering:
    """Draws a schematic (editor format) on white paper, `unit` pixels per grid unit."""
    rng = random.Random(seed)
    xs = [p["x"] for part in schematic["parts"] for p in (part["a"], part["b"])]
    ys = [p["y"] for part in schematic["parts"] for p in (part["a"], part["b"])]
    xs += [p["x"] for w in schematic["wires"] for p in (w["a"], w["b"])] + [
        g["at"]["x"] for g in schematic["grounds"]
    ]
    ys += [p["y"] for w in schematic["wires"] for p in (w["a"], w["b"])] + [
        g["at"]["y"] for g in schematic["grounds"]
    ]
    margin = 2.0
    x_min, y_min = min(xs) - margin, min(ys) - margin
    width = round((max(xs) - x_min + margin + 1) * unit)
    height = round((max(ys) - y_min + margin + 1) * unit)
    image = np.full((height, width, 3), 245, dtype=np.uint8)
    pen = _Pen(image, rng, thickness=3, jitter=jitter)

    def px(p: dict[str, int]) -> tuple[float, float]:
        return ((p["x"] - x_min) * unit, (p["y"] - y_min) * unit)

    detections: list[Detection] = []
    texts: dict[tuple[int, int, int, int], str] = {}
    sources: dict[int, str] = {}

    for wire in schematic["wires"]:
        (ax, ay), (bx, by) = px(wire["a"]), px(wire["b"])
        length = math.hypot(bx - ax, by - ay) or 1
        # Stop a little short of the end, as a hand-drawn line often does.
        g = rng.uniform(0, wire_gap)
        pen.line((ax + (bx - ax) * g / length, ay + (by - ay) * g / length), (bx, by))

    # Junction dots where three or more things meet.
    degree: dict[tuple[int, int], int] = {}
    for item in [*schematic["wires"], *schematic["parts"]]:
        for p in (item["a"], item["b"]):
            degree[(p["x"], p["y"])] = degree.get((p["x"], p["y"]), 0) + 1
    for (x, y), d in degree.items():
        if d >= 3:
            c = px({"x": x, "y": y})
            pen.circle(c, 5, filled=True)
            detections.append(Detection("junction", 1.0, Box(c[0] - 8, c[1] - 8, c[0] + 8, c[1] + 8)))

    for part in schematic["parts"]:
        a, b = px(part["a"]), px(part["b"])
        box = _symbol(pen, part["kind"], a, b, body=unit * 1.15)
        sources[len(detections)] = part["id"]
        detections.append(Detection(part["kind"], 1.0, box))
        if labels:
            text = format_value(part["value"], UNIT_SYMBOLS[part["kind"]])
            horizontal = part["a"]["y"] == part["b"]["y"]
            scale, thick = unit / 60 * 0.8, 2
            (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
            cx, cy = box.center
            # Above a horizontal part, to the right of a vertical one.
            origin = (cx - tw / 2, box.y0 - 10) if horizontal else (box.x1 + 10, cy + th / 2)
            cv2.putText(
                image,
                text,
                (round(origin[0]), round(origin[1])),
                cv2.FONT_HERSHEY_SIMPLEX,
                scale,
                (20, 20, 20),
                thick,
                cv2.LINE_AA,
            )
            tbox = Box(origin[0] - 3, origin[1] - th - 3, origin[0] + tw + 3, origin[1] + base + 3)
            detections.append(Detection("text", 1.0, tbox))
            texts[_key(tbox)] = text

    for ground in schematic["grounds"]:
        gx, gy = px(ground["at"])
        stem = unit * 0.35
        pen.line((gx, gy), (gx, gy + stem))
        for i, w in enumerate((0.45, 0.3, 0.15)):
            yy = gy + stem + i * unit * 0.12
            pen.line((gx - unit * w, yy), (gx + unit * w, yy))
        # The ground's box starts below its attachment point, like a terminal.
        detections.append(
            Detection(
                "ground", 1.0, Box(gx - unit * 0.5, gy + stem * 0.5, gx + unit * 0.5, gy + stem + unit * 0.35)
            )
        )

    return Rendering(image, detections, texts, sources)


def _key(box: Box) -> tuple[int, int, int, int]:
    return (round(box.x0), round(box.y0), round(box.x1), round(box.y1))


class GroundTruthDetector:
    """A 'detector' that returns the rendering's true boxes, for tests."""

    def __init__(self, rendering: Rendering, drop: set[str] | None = None) -> None:
        self.detections = [d for d in rendering.detections if d.label not in (drop or set())]

    def detect(self, image: Image) -> list[Detection]:
        return self.detections


class GroundTruthReader:
    """Returns the text that was drawn in a crop, for tests."""

    def __init__(self, rendering: Rendering) -> None:
        self.texts = rendering.texts
        self.pending = list(rendering.texts.values())

    def read(self, crop: Image) -> Any:
        from .types import TextRead

        # Crops arrive in detection order, which is render order.
        return TextRead(self.pending.pop(0), 0.99) if self.pending else None


def random_ladder(rng: random.Random, branches: int | None = None) -> dict[str, Any]:
    """A random ladder circuit: a source on the left, then branches between a
    top and a bottom rail, some with a series part on the top rail between
    them. Enough variety (kinds, orientations, junctions) for a smoke-test
    dataset; nowhere near the variety of real drawings."""
    branches = branches or rng.randint(1, 4)
    kinds = ["resistor", "resistor", "capacitor", "inductor", "current_source", "voltage_source"]
    values = {
        "resistor": [100, 220, 470, 1000, 2200, 4700, 10_000, 47_000],
        "capacitor": [1e-9, 1e-8, 1e-7, 1e-6, 4.7e-6],
        "inductor": [1e-3, 1e-2, 0.1],
        "voltage_source": [1.5, 3, 5, 9, 12],
        "current_source": [1e-3, 2e-3, 1e-2],
    }
    counts: dict[str, int] = {}

    def make(kind: str, a: tuple[int, int], b: tuple[int, int]) -> dict[str, Any]:
        counts[kind] = counts.get(kind, 0) + 1
        prefix = {"resistor": "R", "capacitor": "C", "inductor": "L", "voltage_source": "V", "current_source": "I"}
        return {
            "id": f"{prefix[kind]}{counts[kind]}",
            "kind": kind,
            "a": {"x": a[0], "y": a[1]},
            "b": {"x": b[0], "y": b[1]},
            "value": rng.choice(values[kind]),
        }

    def wire(p: tuple[int, int], q: tuple[int, int]) -> dict[str, Any]:
        return {"id": "", "a": {"x": p[0], "y": p[1]}, "b": {"x": q[0], "y": q[1]}}

    source = rng.choice(["voltage_source", "voltage_source", "current_source"])
    a, b = ((0, 3), (0, 1)) if source == "current_source" else ((0, 1), (0, 3))
    parts = [make(source, a, b)]
    wires = [wire((0, 1), (0, 0)), wire((0, 3), (0, 4))]
    x = 0
    for _ in range(branches):
        start = x
        if rng.random() < 0.6:  # a series part on the top rail first
            parts.append(make(rng.choice(kinds[:4]), (x + 1, 0), (x + 3, 0)))
            wires.append(wire((x, 0), (x + 1, 0)))
            x += 3
        # Three units apart, so each value label has room beside its part.
        nx = x + 3
        wires += [wire((x, 0), (nx, 0)), wire((nx, 0), (nx, 1)), wire((nx, 3), (nx, 4)), wire((start, 4), (nx, 4))]
        kind = rng.choice(kinds)
        # Drawn the conventional way up (arrow up, + on top), which is what
        # the pipeline assumes when it cannot see polarity.
        a, b = ((nx, 3), (nx, 1)) if kind == "current_source" else ((nx, 1), (nx, 3))
        parts.append(make(kind, a, b))
        x = nx
    for i, w in enumerate(wires):
        w["id"] = f"W{i + 1}"
    grounds = [{"id": "G1", "at": {"x": rng.randint(0, x), "y": 4}}]
    return {"parts": parts, "wires": wires, "grounds": grounds}
