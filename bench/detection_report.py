"""Detection accuracy table from the trained model's metrics.

    python bench/detection_report.py [ml/weights/metrics.json]

train.py writes metrics.json after evaluating the exported ONNX model on the
held-out test drafters. This prints the markdown table for
docs/benchmarks.md, or says how to produce the file if it is missing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parents[1] / "ml/weights/metrics.json")
if not path.exists():
    sys.exit(f"{path} not found: train a model first (ml/training/colab.ipynb)")

metrics = json.loads(path.read_text())
test = metrics["test_onnx"]
model, size, epochs = metrics["model"], metrics["imgsz"], metrics["epochs"]
print(f"Model: {model} at {size} px, {epochs} epochs; test split = held-out drafters\n")
print("| Class | Precision | Recall | mAP@50 | mAP@50-95 |")
print("|-------|----------:|-------:|-------:|----------:|")
for name, m in test["per_class"].items():
    print(f"| {name} | {m['precision']:.3f} | {m['recall']:.3f} | {m['mAP50']:.3f} | {m['mAP50-95']:.3f} |")
overall = [test[k] for k in ("precision", "recall", "mAP50", "mAP50-95")]
print("| **all** | " + " | ".join(f"**{v:.3f}**" for v in overall) + " |")
