"""Evaluates the whole pipeline with the trained model, not just the detector.

Detection mAP (from train.py) says how well symbols are found. What a user
cares about is whether the *circuit* comes out right, which also depends on
wire tracing, OCR and layout. This script measures that:

    python training/evaluate.py --model weights/model.onnx --synthetic 100
        End-to-end accuracy on rendered circuits with known netlists: the
        fraction whose recovered netlist is exactly right, and whose
        components are all found, plus time per stage.

    python training/evaluate.py --model weights/model.onnx --photos my_photos/ --out runs/overlays
        Runs on real photos and saves each with its detections drawn on, and
        the JSON the API would return, for checking by eye.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from schematica_vision import OnnxDetector, RapidTextReader, recognize  # noqa: E402
from schematica_vision.compare import difference  # noqa: E402
from schematica_vision.image import Image, decode  # noqa: E402
from schematica_vision.layout import netlist_of  # noqa: E402
from schematica_vision.synthetic import random_ladder, render  # noqa: E402

COLORS = {"used": (40, 160, 40), "other": (0, 140, 255), "mark": (200, 120, 0)}


def draw(image: Image, result: dict[str, Any]) -> Image:
    out = image.copy()
    for d in result["detections"]:
        x0, y0, x1, y1 = (round(v) for v in d["box"])
        color = (
            COLORS["used"] if d["part_id"] else COLORS["other"] if d["label"] == "other" else COLORS["mark"]
        )
        cv2.rectangle(out, (x0, y0), (x1, y1), color, 2)
        caption = f"{d['part_id'] or d['label']} {d['confidence']:.2f}"
        cv2.putText(
            out, caption, (x0, max(12, y0 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA
        )
    return out


def synthetic(detector: OnnxDetector, reader: RapidTextReader | None, count: int) -> dict[str, Any]:
    rng = random.Random(1234)  # different circuits from the training set's seed
    exact = all_found = 0
    times = []
    for i in range(count):
        schematic = random_ladder(rng)
        # Unique values, so components can be matched by type and value.
        for j, part in enumerate(schematic["parts"]):
            part["value"] = part["value"] * (1 + j / 100)
        rendering = render(schematic, unit=rng.uniform(45, 75), seed=10_000 + i, jitter=rng.uniform(0.5, 2.5))
        start = time.perf_counter()
        result = recognize(rendering.image, detector, reader)
        times.append(time.perf_counter() - start)
        found = len(result["netlist"]["components"]) == len(schematic["parts"])
        all_found += found
        exact += found and difference(result["netlist"], netlist_of(schematic)) is None
    return {
        "circuits": count,
        "all_components_found": round(all_found / count, 3),
        "netlist_exact": round(exact / count, 3),
        "median_seconds": round(statistics.median(times), 3),
    }


def photos(detector: OnnxDetector, reader: RapidTextReader | None, folder: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for path in sorted(p for p in folder.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}):
        start = time.perf_counter()
        result = recognize(path.read_bytes(), detector, reader)
        seconds = time.perf_counter() - start
        cv2.imwrite(str(out / f"{path.stem}.overlay.jpg"), draw(decode(path.read_bytes()), result))
        (out / f"{path.stem}.json").write_text(json.dumps(result, indent=1))
        parts = len(result["netlist"]["components"])
        print(f"{path.name}: {parts} parts, {len(result['warnings'])} warnings, {seconds:.2f} s")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--model", type=Path, default=ROOT / "weights/model.onnx")
    parser.add_argument("--synthetic", type=int, metavar="N")
    parser.add_argument("--photos", type=Path)
    parser.add_argument("--out", type=Path, default=Path("runs/overlays"))
    parser.add_argument("--no-ocr", action="store_true")
    args = parser.parse_args()

    detector = OnnxDetector(args.model)
    reader = None if args.no_ocr else RapidTextReader()
    if args.synthetic:
        print(json.dumps(synthetic(detector, reader, args.synthetic), indent=2))
    if args.photos:
        photos(detector, reader, args.photos, args.out)
    if not args.synthetic and not args.photos:
        parser.error("pass --synthetic N and/or --photos FOLDER")


if __name__ == "__main__":
    main()
