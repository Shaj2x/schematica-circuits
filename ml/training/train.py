"""Trains the YOLOv8 symbol detector and exports it for the app.

    python training/train.py --data data/yolo/data.yaml               # real run (GPU)
    python training/train.py --data data/synthetic/data.yaml --smoke  # 2-minute CPU check

Steps: fine-tune a COCO-pretrained YOLOv8 on our classes, evaluate the best
checkpoint on the held-out test drafters, export it to ONNX, then evaluate
the *ONNX file* too, so the numbers in the README describe exactly the model
the backend runs. Writes weights/model.onnx and weights/metrics.json.

Choices worth knowing:

* imgsz 1024, not the default 640. Junction dots and handwritten values are
  a few pixels wide at 640 on a full-page photo.
* fliplr 0.5 but no vertical flips or large rotations: a ground symbol
  upside down is not a ground symbol, and a mirrored "+" is still a "+".
* Small rotations (±5°) and perspective, because phone photos are never
  perfectly square to the page.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schematica_vision.classes import CLASSES

WEIGHTS = Path(__file__).resolve().parents[1] / "weights"


def metrics_of(result: Any) -> dict[str, Any]:
    """Ultralytics' validation result -> plain numbers, overall and per class."""
    box = result.box
    per_class = {}
    for i, c in enumerate(box.ap_class_index):
        per_class[CLASSES[int(c)]] = {
            "precision": round(float(box.p[i]), 4),
            "recall": round(float(box.r[i]), 4),
            "mAP50": round(float(box.ap50[i]), 4),
            "mAP50-95": round(float(box.ap[i]), 4),
        }
    return {
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "mAP50": round(float(box.map50), 4),
        "mAP50-95": round(float(box.map), 4),
        "per_class": per_class,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--data", type=Path, required=True, help="data.yaml from prepare_dataset.py")
    parser.add_argument(
        "--model", default="yolov8s.pt", help="starting weights (yolov8n.pt is faster, less accurate)"
    )
    parser.add_argument("--epochs", type=int, help="default 100, or 3 with --smoke")
    parser.add_argument("--imgsz", type=int, default=1024)
    parser.add_argument("--batch", type=int, default=-1, help="-1 picks the largest that fits in GPU memory")
    parser.add_argument(
        "--smoke", action="store_true", help="tiny CPU run from scratch, to test the pipeline"
    )
    parser.add_argument("--out", type=Path, default=WEIGHTS)
    args = parser.parse_args()

    from ultralytics import YOLO

    if args.smoke:
        # From scratch (no download), tiny and short: checks that training,
        # export and ONNX evaluation all work, not that the model is good.
        model = YOLO("yolov8n.yaml")
        train_args: dict[str, Any] = {
            "epochs": args.epochs or 3,
            "imgsz": 320,
            "batch": 8,
            "device": "cpu",
            "workers": 0,
        }
    else:
        model = YOLO(args.model)
        train_args = {"epochs": args.epochs or 100, "imgsz": args.imgsz, "batch": args.batch, "patience": 25}

    model.train(
        data=str(args.data),
        project=str(Path("runs").resolve()),
        name="detect",
        exist_ok=True,
        plots=False,
        fliplr=0.5,
        flipud=0.0,
        degrees=5.0,
        perspective=0.0005,
        **train_args,
    )
    imgsz = train_args["imgsz"]
    best = Path(model.trainer.best)
    print(f"best checkpoint: {best}")

    test = metrics_of(YOLO(best).val(data=str(args.data), split="test", imgsz=imgsz, plots=False))

    onnx_path = Path(YOLO(best).export(format="onnx", imgsz=imgsz, opset=17, simplify=True, dynamic=False))
    onnx_test = metrics_of(
        YOLO(onnx_path, task="detect").val(
            data=str(args.data), split="test", imgsz=imgsz, plots=False, batch=1
        )
    )

    args.out.mkdir(parents=True, exist_ok=True)
    shutil.copy(onnx_path, args.out / "model.onnx")
    metrics = {
        "model": "yolov8n (smoke test, synthetic data)" if args.smoke else args.model.removesuffix(".pt"),
        "dataset": str(args.data),
        "imgsz": imgsz,
        "epochs": train_args["epochs"],
        "test": test,
        "test_onnx": onnx_test,
    }
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps({k: v for k, v in onnx_test.items() if k != "per_class"}, indent=2))
    print(f"wrote {args.out / 'model.onnx'} and {args.out / 'metrics.json'}")


if __name__ == "__main__":
    main()
