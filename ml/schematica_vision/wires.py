"""Wire tracing: which part terminals are joined by ink.

Detection says where the symbols are; this stage works out how they are
wired. The idea is the same as the editor's netlist derivation, applied to
pixels instead of grid points:

1. Erase every detected symbol (and every piece of text) from the ink mask.
   What is left is wires, broken at each symbol.
2. Close small gaps, because a pen stroke rarely meets another one exactly.
3. Label connected components of the remaining ink: each one is a net.
4. Look just outside each symbol's box, on each side, for the net that
   touches it there. The pair of opposite sides with more ink is the
   symbol's axis, and the net on each of those two sides is a terminal.

Crossovers (a hop drawn where two wires cross without joining) are erased
too, and the wire stubs on opposite sides are joined back up afterwards:
left with right, top with bottom.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from .classes import COMPONENT_KINDS
from .image import Image
from .types import Box, Detection

Side = Literal["left", "right", "top", "bottom"]
Axis = Literal["horizontal", "vertical"]

OPPOSITE: dict[Side, Side] = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}


@dataclass(frozen=True)
class Terminal:
    side: Side
    net: int | None  # None: no wire touches this side
    point: tuple[float, float]  # middle of the box edge, in pixels


@dataclass(frozen=True)
class TracedPart:
    detection: Detection
    axis: Axis
    terminals: tuple[Terminal, Terminal]  # left/right or top/bottom, in that order


@dataclass(frozen=True)
class TracedGround:
    detection: Detection
    terminal: Terminal


@dataclass(frozen=True)
class TracedOther:
    """A symbol we cannot simulate, with the nets it is wired into."""

    detection: Detection
    nets: frozenset[int]


@dataclass(frozen=True)
class Tracing:
    parts: list[TracedPart]
    grounds: list[TracedGround]
    others: list[TracedOther]
    labels: NDArray[Any]  # net id per pixel (0 = no wire), for debugging overlays


def _clip(box: Box, shape: tuple[int, ...]) -> tuple[int, int, int, int]:
    height, width = shape[:2]
    x0, y0 = max(0, int(np.floor(box.x0))), max(0, int(np.floor(box.y0)))
    x1, y1 = min(width, int(np.ceil(box.x1))), min(height, int(np.ceil(box.y1)))
    return x0, y0, x1, y1


def _strips(box: Box, margin: float) -> dict[Side, Box]:
    """Thin regions just outside each edge of a box."""
    return {
        "left": Box(box.x0 - margin, box.y0, box.x0, box.y1),
        "right": Box(box.x1, box.y0, box.x1 + margin, box.y1),
        "top": Box(box.x0, box.y0 - margin, box.x1, box.y0),
        "bottom": Box(box.x0, box.y1, box.x1, box.y1 + margin),
    }


def _edge_midpoint(box: Box, side: Side) -> tuple[float, float]:
    cx, cy = box.center
    return {
        "left": (box.x0, cy),
        "right": (box.x1, cy),
        "top": (cx, box.y0),
        "bottom": (cx, box.y1),
    }[side]


def _touching(labels: NDArray[Any], region: Box) -> tuple[int | None, int]:
    """The net with the most pixels in a region, and how many it has."""
    x0, y0, x1, y1 = _clip(region, labels.shape)
    if x1 <= x0 or y1 <= y0:
        return None, 0
    counts = np.bincount(labels[y0:y1, x0:x1].ravel())
    counts[0] = 0
    best = int(counts.argmax())
    return (best, int(counts[best])) if counts[best] > 0 else (None, 0)


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)


def trace(ink: Image, detections: list[Detection]) -> Tracing:
    symbols = [d for d in detections if d.label != "junction"]  # dots are wire, keep their ink
    wires = ink.copy()
    for detection in symbols:
        x0, y0, x1, y1 = _clip(detection.box, wires.shape)
        wires[y0:y1, x0:x1] = 0

    # Bridge small gaps between strokes. The kernel scales with the drawing:
    # about 0.5% of the image, a few pixels for a typical phone photo.
    k = max(3, round(max(int(n) for n in ink.shape[:2]) * 0.005)) | 1
    wires = cv2.morphologyEx(wires, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    _, labels = cv2.connectedComponents(wires, connectivity=8)
    labels = labels.astype(np.int32)

    def margin_of(box: Box) -> float:
        return max(6.0, 0.15 * min(box.width, box.height), 2.0 * k)

    # Crossovers: rejoin the wire on each side with the one opposite it.
    uf = _UnionFind()
    for detection in detections:
        if detection.label != "crossover":
            continue
        strips = _strips(detection.box, margin_of(detection.box))
        for side in ("left", "top"):
            a, _ = _touching(labels, strips[side])
            b, _ = _touching(labels, strips[OPPOSITE[side]])
            if a is not None and b is not None:
                uf.union(a, b)

    def net(label: int | None) -> int | None:
        return None if label is None else uf.find(label)

    parts: list[TracedPart] = []
    grounds: list[TracedGround] = []
    others: list[TracedOther] = []
    for detection in detections:
        if detection.label in ("junction", "crossover", "text"):
            continue
        box = detection.box
        touching = {side: _touching(labels, strip) for side, strip in _strips(box, margin_of(box)).items()}
        terminal = {
            side: Terminal(side, net(label), _edge_midpoint(box, side))
            for side, (label, _) in touching.items()
        }

        if detection.label in COMPONENT_KINDS:
            horizontal = touching["left"][1] + touching["right"][1]
            vertical = touching["top"][1] + touching["bottom"][1]
            # Ties (nothing touching either axis) fall back to the box shape.
            if horizontal > vertical or (horizontal == vertical and box.width >= box.height):
                parts.append(TracedPart(detection, "horizontal", (terminal["left"], terminal["right"])))
            else:
                parts.append(TracedPart(detection, "vertical", (terminal["top"], terminal["bottom"])))
        elif detection.label == "ground":
            side = max(touching, key=lambda s: touching[s][1])
            grounds.append(TracedGround(detection, terminal[side]))
        else:
            nets = frozenset(t.net for t in terminal.values() if t.net is not None)
            others.append(TracedOther(detection, nets))

    return Tracing(parts, grounds, others, labels)
