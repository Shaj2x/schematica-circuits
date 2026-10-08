"""Builds a YOLO dataset from CGHD, or a synthetic one for smoke tests.

CGHD (Circuit Graph Hand-Drawn, Thoma et al., KIT) is a public set of photos
and scans of hand-drawn circuits, by many different drafters, labelled with
PASCAL VOC bounding boxes. This script:

1. reads every VOC annotation under the dataset folder,
2. maps CGHD's ~45 symbol names onto our 10 classes (see CLASS_MAP),
3. splits by *drafter*, not by image, so the test set measures how well the
   model reads handwriting it has never seen. A random image split would put
   the same person's drawings in train and test, and the test score would
   mostly measure memorised handwriting,
4. downsizes images (photos are up to 4000 px; training uses ~1024) and
   writes YOLO labels plus data.yaml.

    python training/prepare_dataset.py --cghd data/cghd --out data/yolo
    python training/prepare_dataset.py --synthetic 300 --out data/synthetic
"""

from __future__ import annotations

import argparse
import random
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schematica_vision.classes import CLASSES  # noqa: E402
from schematica_vision.synthetic import random_ladder, render  # noqa: E402

# CGHD label -> our class, or None to drop the box. Unlisted labels become
# "other": a real symbol we cannot simulate, which the app reports instead of
# wiring straight through. Matching is on the full name first, then on the
# part before the first dot ("capacitor.polarized" -> "capacitor").
CLASS_MAP: dict[str, str | None] = {
    "resistor": "resistor",
    "resistor.adjustable": "resistor",
    "resistor.photo": "other",
    "capacitor": "capacitor",
    "inductor": "inductor",
    "inductor.ferrite": "inductor",
    "inductor.coupled": "other",
    "voltage.dc": "voltage_source",
    "voltage.battery": "voltage_source",
    "voltage.ac": "other",  # AC sources are not simulated yet
    "current.dc": "current_source",
    "current": "current_source",
    "gnd": "ground",
    "vss": "ground",
    "junction": "junction",
    "crossover": "crossover",
    "text": "text",
    # Not symbols: open wire ends, annotations and unreadable marks.
    "terminal": None,
    "explanatory": None,
    "unknown": None,
}

MAX_SIDE = 1600
SPLITS = ("train", "val", "test")


@dataclass
class Sample:
    image: Path
    drafter: str
    boxes: list[tuple[int, float, float, float, float]]  # class, x0, y0, x1, y1 (pixels)


def map_label(name: str) -> str | None:
    name = name.strip().lower()
    if name in CLASS_MAP:
        return CLASS_MAP[name]
    if (base := name.split(".")[0]) in CLASS_MAP:
        return CLASS_MAP[base]
    return "other"


def find_image(xml_path: Path, filename: str) -> Path | None:
    for candidate in (
        xml_path.parent / filename,
        xml_path.parent.parent / "images" / filename,
        xml_path.parent.parent / filename,
    ):
        if candidate.exists():
            return candidate
    matches = list(xml_path.parent.parent.rglob(Path(filename).name))
    return matches[0] if matches else None


def read_cghd(root: Path, counts: Counter[str]) -> list[Sample]:
    samples = []
    for xml_path in sorted(root.rglob("*.xml")):
        try:
            tree = ET.parse(xml_path)
        except ET.ParseError:
            continue
        annotation = tree.getroot()
        if annotation.tag != "annotation":
            continue
        filename = annotation.findtext("filename") or f"{xml_path.stem}.jpg"
        image = find_image(xml_path, filename)
        if image is None:
            print(f"warning: no image for {xml_path}", file=sys.stderr)
            continue
        match = re.search(r"drafter[_-]?(\d+)", str(xml_path), re.IGNORECASE)
        drafter = match.group(1) if match else xml_path.parent.parent.name
        boxes = []
        for obj in annotation.iter("object"):
            name = obj.findtext("name") or "unknown"
            mapped = map_label(name)
            counts[f"{name} -> {mapped}"] += 1
            box = obj.find("bndbox")
            if mapped is None or box is None:
                continue
            x0, y0, x1, y1 = (float(box.findtext(k) or 0) for k in ("xmin", "ymin", "xmax", "ymax"))
            if x1 > x0 and y1 > y0:
                boxes.append((CLASSES.index(mapped), x0, y0, x1, y1))
        samples.append(Sample(image, drafter, boxes))
    return samples


def split_by_drafter(samples: list[Sample], seed: int, val: float, test: float) -> dict[str, list[Sample]]:
    drafters = sorted({s.drafter for s in samples}, key=lambda d: (len(d), d))
    random.Random(seed).shuffle(drafters)
    n_test = max(1, round(len(drafters) * test))
    n_val = max(1, round(len(drafters) * val))
    assignment = {d: "test" for d in drafters[:n_test]}
    assignment |= {d: "val" for d in drafters[n_test : n_test + n_val]}
    print("drafters per split:", {s: sorted(d for d, v in assignment.items() if v == s) for s in ("val", "test")})
    return {split: [s for s in samples if assignment.get(s.drafter, "train") == split] for split in SPLITS}


def write_split(samples: list[Sample], out: Path, split: str) -> None:
    (out / "images" / split).mkdir(parents=True, exist_ok=True)
    (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    for i, sample in enumerate(samples):
        image = cv2.imread(str(sample.image))
        if image is None:
            print(f"warning: unreadable {sample.image}", file=sys.stderr)
            continue
        height, width = image.shape[:2]
        scale = min(1.0, MAX_SIDE / max(height, width))
        if scale < 1:
            image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        stem = f"{sample.drafter}_{i:05d}_{sample.image.stem}"
        cv2.imwrite(str(out / "images" / split / f"{stem}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        # YOLO labels are normalised, so they do not change with the resize.
        lines = [
            f"{c} {(x0 + x1) / 2 / width:.6f} {(y0 + y1) / 2 / height:.6f} "
            f"{(x1 - x0) / width:.6f} {(y1 - y0) / height:.6f}"
            for c, x0, y0, x1, y1 in sample.boxes
        ]
        (out / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""))


def synthetic_samples(count: int, out: Path, seed: int) -> list[Sample]:
    """Renders random circuits to `out/rendered` and returns them as samples.
    Each image is its own 'drafter', so the split is simply random."""
    rendered = out / "rendered"
    rendered.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    samples = []
    for i in range(count):
        rendering = render(random_ladder(rng), unit=rng.uniform(40, 80), seed=i, jitter=rng.uniform(0.5, 2.5))
        path = rendered / f"synthetic_{i:05d}.png"
        cv2.imwrite(str(path), rendering.image)
        boxes = [
            (CLASSES.index(d.label), d.box.x0, d.box.y0, d.box.x1, d.box.y1) for d in rendering.detections
        ]
        samples.append(Sample(path, str(i), boxes))
    return samples


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--cghd", type=Path, help="folder the CGHD archive was extracted to")
    source.add_argument("--synthetic", type=int, metavar="N", help="render N random circuits instead")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--val", type=float, default=0.15, help="fraction of drafters for validation")
    parser.add_argument("--test", type=float, default=0.15, help="fraction of drafters for testing")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    counts: Counter[str] = Counter()
    if args.cghd:
        samples = read_cghd(args.cghd, counts)
        if not samples:
            sys.exit(f"no PASCAL VOC annotations found under {args.cghd}")
        print("label mapping (count):")
        for label, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"  {n:6d}  {label}")
    else:
        samples = synthetic_samples(args.synthetic, args.out, args.seed)

    splits = split_by_drafter(samples, args.seed, args.val, args.test)
    for split, items in splits.items():
        write_split(items, args.out, split)
        n_boxes = Counter(CLASSES[b[0]] for s in items for b in s.boxes)
        print(f"{split}: {len(items)} images, boxes: {dict(sorted(n_boxes.items()))}")

    names = "\n".join(f"  {i}: {name}" for i, name in enumerate(CLASSES))
    (args.out / "data.yaml").write_text(
        f"path: {args.out.resolve()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n{names}\n"
    )
    print(f"wrote {args.out / 'data.yaml'}")


if __name__ == "__main__":
    main()
