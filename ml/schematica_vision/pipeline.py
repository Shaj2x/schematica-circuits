"""Photo -> editor schematic: the whole pipeline, stage by stage.

    decode -> ink mask -> detect -> trace wires -> read text -> assign values
           -> layout on the grid -> verify connectivity -> report

The result is a starting point for the editor, not a final answer. Every
guess the pipeline makes (a low-confidence detection, a value it could not
read, a source whose polarity it cannot see) becomes a warning that names
the parts involved, so the UI can point the user at what to check.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Any

from .classes import COMPONENT_KINDS, DEFAULT_VALUE, ID_PREFIX
from .detector import Detector
from .image import Image, decode, ink_mask
from .layout import GroundSpec, PartSpec, layout
from .ocr import TextReader
from .types import Detection
from .values import Reading, read_text
from .wires import TracedPart, trace

LOW_CONFIDENCE = 0.5

SYMBOLS = frozenset({*COMPONENT_KINDS, "ground", "other"})


def _one_label_per_symbol(detections: list[Detection], overlap: float = 0.6) -> list[Detection]:
    """The detector runs NMS per class, so one unclear squiggle can come back
    as both a resistor and an inductor. A symbol is one thing: of symbol boxes
    that mostly overlap, keep the most confident. Marks (text, junctions,
    crossovers) are left alone; they legitimately sit on or inside symbols."""
    kept: list[Detection] = []
    for d in sorted((d for d in detections if d.label in SYMBOLS), key=lambda d: -d.confidence):
        duplicate = any(
            d.box.iou(k.box) > overlap or d.box.intersection(k.box) > 0.85 * min(d.box.area(), k.box.area())
            for k in kept
        )
        if not duplicate:
            kept.append(d)
    keep = {id(d) for d in kept}
    return [d for d in detections if d.label not in SYMBOLS or id(d) in keep]


@dataclass
class _Part:
    traced: TracedPart
    kind: str
    label: str | None = None
    value: float | None = None
    value_text: str | None = None


def _reading_order(box_center: tuple[float, float], row_height: float) -> tuple[int, float]:
    x, y = box_center
    return (round(y / row_height), x)


def _crop(image: Image, detection: Detection, pad: float = 0.15) -> Image:
    box = detection.box
    dx, dy = box.width * pad, box.height * pad
    height, width = image.shape[:2]
    x0, y0 = max(0, int(box.x0 - dx)), max(0, int(box.y0 - dy))
    x1, y1 = min(width, int(box.x1 + dx)), min(height, int(box.y1 + dy))
    return image[y0:y1, x0:x1]


def _assign_text(parts: list[_Part], texts: list[tuple[Detection, str, Reading]], reach: float) -> None:
    """Gives each part the nearest label and the nearest value written next
    to it. Greedy over all (text, part) pairs, closest first, so two values
    between two resistors each go to the resistor they are closer to. A value
    with a unit ("100nF") only goes to a part of the matching kind."""
    for field in ("label", "value"):
        pairs = []
        for t, (detection, _, reading) in enumerate(texts):
            if getattr(reading, field) is None:
                continue
            for p, part in enumerate(parts):
                if field == "value" and reading.value and reading.value.kind not in (None, part.kind):
                    continue
                if field == "label" and reading.label and ID_PREFIX[part.kind] != reading.label[0]:
                    continue
                distance = detection.box.distance_to(part.traced.detection.box)
                if distance <= reach:
                    pairs.append((distance, t, p))
        used_text: set[int] = set()
        used_part: set[int] = set()
        for _, t, p in sorted(pairs):
            if t in used_text or p in used_part:
                continue
            used_text.add(t)
            used_part.add(p)
            _, text, reading = texts[t]
            if field == "label":
                parts[p].label = reading.label
            else:
                assert reading.value is not None
                parts[p].value, parts[p].value_text = reading.value.value, text


def recognize(
    data: bytes | Image,
    detector: Detector,
    reader: TextReader | None = None,
) -> dict[str, Any]:
    image = decode(data) if isinstance(data, bytes) else data
    ink = ink_mask(image)
    detections = _one_label_per_symbol(detector.detect(image))
    tracing = trace(ink, detections)

    warnings: list[dict[str, Any]] = []

    def warn(code: str, message: str, part_ids: list[str] | None = None) -> None:
        warnings.append({"code": code, "message": message, "part_ids": part_ids or []})

    sizes = [max(p.detection.box.width, p.detection.box.height) for p in tracing.parts]
    part_size = median(sizes) if sizes else 80.0

    parts = [_Part(t, t.detection.label) for t in tracing.parts]
    parts.sort(key=lambda p: _reading_order(p.traced.detection.box.center, part_size))

    # Text.
    text_detections = [d for d in detections if d.label == "text"]
    texts: list[tuple[Detection, str, Reading]] = []
    if reader is not None:
        for detection in text_detections:
            read = reader.read(_crop(image, detection))
            if read is not None:
                texts.append((detection, read.text, read_text(read.text)))
    elif text_detections:
        warn("ocr_unavailable", "Text recognition is not installed, so values were not read.")
    _assign_text(parts, texts, reach=1.5 * part_size)

    # Ids: use the label written on the drawing when it is unique, else number by reading order.
    written = [p.label for p in parts if p.label]
    taken = {label for label in written if written.count(label) == 1}
    counters: dict[str, int] = {}
    ids: list[str] = []
    for part in parts:
        if part.label in taken:
            ids.append(part.label)
            continue
        prefix = ID_PREFIX[part.kind]
        n = counters.get(prefix, 0)
        while f"{prefix}{n + 1}" in taken or f"{prefix}{n + 1}" in ids:
            n += 1
        counters[prefix] = n + 1
        ids.append(f"{prefix}{n + 1}")

    specs = []
    for part, part_id in zip(parts, ids, strict=True):
        first, second = part.traced.terminals
        # Which terminal is `a`: top/left, except a current source, whose
        # arrow conventionally points up or right, so it flows from the
        # bottom/left terminal. Voltage sources put + at the top/left.
        if part.kind == "current_source" and part.traced.axis == "vertical":
            first, second = second, first
        box = part.traced.detection.box
        specs.append(
            PartSpec(
                id=part_id,
                kind=part.kind,
                value=part.value if part.value is not None else DEFAULT_VALUE[part.kind],
                axis=part.traced.axis,
                center=box.center,
                length=box.width if part.traced.axis == "horizontal" else box.height,
                nets=(first.net, second.net),
            )
        )
    grounds = [
        GroundSpec(f"G{i + 1}", g.terminal.point, g.terminal.net) for i, g in enumerate(tracing.grounds)
    ]
    result = layout(specs, grounds)

    # Warnings, in the order a user would fix them.
    if not detections:
        warn("nothing_found", "No circuit symbols were found. Try a closer, evenly lit photo.")
    if tracing.others:
        count = len(tracing.others)
        warn(
            "unsupported_symbol",
            f"{count} symbol{'s' if count > 1 else ''} other than resistors, sources, capacitors and "
            "inductors (marked on the photo) left out, so the circuit around them is incomplete.",
        )
    low = [s.id for s, p in zip(specs, parts, strict=True) if p.traced.detection.confidence < LOW_CONFIDENCE]
    if low:
        warn("low_confidence", "Check these parts: the detector was unsure what they are.", low)
    open_ends = [
        s.id for s, p in zip(specs, parts, strict=True) if any(t.net is None for t in p.traced.terminals)
    ]
    if open_ends:
        warn("unconnected", "No wire was found on one side of these parts.", open_ends)
    shorted = [s.id for s in specs if s.nets[0] is not None and s.nets[0] == s.nets[1]]
    if shorted:
        warn(
            "shorted",
            "Both ends of these parts are on the same wire, so they do nothing. "
            "A symbol between them may have been missed.",
            shorted,
        )
    if result.unrouted:
        warn(
            "unrouted",
            "The wiring of these parts could not be redrawn safely; check their connections.",
            result.unrouted,
        )
    unread = [s.id for s, p in zip(specs, parts, strict=True) if p.value is None]
    if unread and reader is not None:
        warn("default_value", "No value was read for these parts, so they have the default value.", unread)
    sources = [s.id for s in specs if s.kind in ("voltage_source", "current_source")]
    if sources:
        warn(
            "polarity",
            "Source polarity is assumed (+ at the top or left); flip a source if it is backwards.",
            sources,
        )
    if not tracing.grounds and specs:
        warn("no_ground", "No ground symbol was found. Add one to the node you want as 0 V.")

    part_of = {id(p.traced.detection): s for p, s in zip(parts, specs, strict=True)}
    value_text = {s.id: p.value_text for p, s in zip(parts, specs, strict=True)}
    return {
        "image": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "schematic": result.schematic,
        "netlist": result.netlist,
        "detections": [
            {
                "label": d.label,
                "confidence": round(d.confidence, 3),
                "box": d.box.as_list(),
                "part_id": part_of[id(d)].id if id(d) in part_of else None,
                "value_text": value_text.get(part_of[id(d)].id) if id(d) in part_of else None,
            }
            for d in detections
        ],
        "warnings": warnings,
    }
