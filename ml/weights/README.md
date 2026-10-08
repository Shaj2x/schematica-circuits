# Trained weights

| File | What | Made by |
|------|------|---------|
| `model.onnx` | The YOLOv8 symbol detector, exported for onnxruntime | `training/train.py` |
| `metrics.json` | Its scores on the held-out test drafters, from both the PyTorch checkpoint and this ONNX file | `training/train.py` |

The backend looks for `model.onnx` here (or wherever `SCHEMATICA_MODEL_PATH`
points). A YOLOv8s export is about 45 MB and YOLOv8n about 12 MB. Both are
small enough to commit directly, so a fresh clone runs the full app with no
download step. Retraining replaces the file in a normal commit.

If this folder has no `model.onnx`, photo upload answers 503 "no model
installed", and everything else works.
