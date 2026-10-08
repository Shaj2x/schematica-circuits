# ml: from a photo to an editable schematic

This folder has two halves:

- **`schematica_vision/`**: the recognition pipeline the backend runs. It is
  plain NumPy and OpenCV plus onnxruntime, with no PyTorch.
- **`training/`**: scripts to build the dataset, train the YOLOv8 detector and
  export it to ONNX. These need Ultralytics and a GPU (Colab is fine).

```
photo ─► ink mask ─► YOLOv8 (ONNX) ─► wire tracing ─► OCR ─► grid layout ─► editor schematic
          image.py    detector.py       wires.py      ocr.py   layout.py      + warnings
```

The full write-up of the design is in [`docs/vision.md`](../docs/vision.md).

## Setup

```bash
cd ml
uv sync --extra ocr                     # pipeline + OCR, enough to run the app
uv sync --extra ocr --group train       # + Ultralytics/PyTorch for training
uv run --group dev pytest               # tests, no model needed
```

## Training a model

### On Colab (recommended)

Open [`training/colab.ipynb`](training/colab.ipynb) in Colab. Choose
Runtime → Change runtime type → T4 GPU, then Runtime → Run all. It
downloads CGHD, prepares it, trains for about an hour, and downloads
`model.onnx` and `metrics.json` when it finishes. Put both files in
`ml/weights/`.

### Locally

```bash
# 1. Get CGHD (see "Dataset" below) and extract it to ml/data/cghd
uv run python training/prepare_dataset.py --cghd data/cghd --out data/yolo
# 2. Train (GPU strongly recommended), evaluate on the held-out drafters, export
uv run --group train python training/train.py --data data/yolo/data.yaml
# 3. End-to-end check of the whole pipeline with the new model
uv run python training/evaluate.py --synthetic 100
uv run python training/evaluate.py --photos path/to/photos --out runs/overlays
```

To check that the training code works without the dataset or a GPU (about
2 minutes on a laptop CPU):

```bash
uv run python training/prepare_dataset.py --synthetic 200 --out data/synthetic
uv run --group train python training/train.py --data data/synthetic/data.yaml --smoke --out runs/smoke
```

## Dataset

**CGHD (Circuit Graph Hand-Drawn)** is a public dataset of photos and scans
of hand-drawn circuits by many different drafters. It is labelled with
bounding boxes in PASCAL VOC XML for around 45 symbol classes, including
text, junctions and crossovers. It comes from the group of Johannes Bayer at
DFKI and KIT.

- Paper: *A Public Ground-Truth Dataset for Handwritten Circuit Diagram Images*
  (Thoma, Bayer et al., ICDAR 2021 workshops).
- Downloads: Zenodo (search "CGHD") and Kaggle (search "CGHD"). New versions
  add images, so use the newest. Check the licence on the dataset page (it is
  a Creative Commons attribution licence), and credit the dataset wherever its
  images appear.

`prepare_dataset.py` reads any folder of VOC XML files, so it does not depend
on one exact release. It prints every label it saw and the class it mapped to,
so a renamed class shows up in the output instead of silently becoming
`other`.

### Our classes

| Class | From CGHD | Why |
|-------|-----------|-----|
| `resistor`, `capacitor`, `inductor` | `resistor`, `resistor.adjustable`, `capacitor.*`, `inductor`, `inductor.ferrite` | The parts the solver supports |
| `voltage_source` | `voltage.dc`, `voltage.battery` | DC sources |
| `current_source` | `current.*` | DC current sources |
| `ground` | `gnd`, `vss` | Sets the 0 V node |
| `junction`, `crossover` | same | Tell wire tracing where wires join and where they only cross |
| `text` | `text` | Values and labels, read by OCR |
| `other` | everything else (diodes, transistors, op-amps, AC sources…) | So unsupported parts are reported, not wired straight through |

`terminal`, `explanatory` and `unknown` boxes are dropped.

### Split by drafter

The test set is whole drafters the model never saw in training. CGHD has
many drawings per person. With a random split, the test set would contain the
same people's handwriting as the training set, and the score would mostly
measure memorised handwriting rather than reading a new person's drawing.

## Labeling your own photos

Photos you draw yourself are the most honest test, and the best way to fix
what the model gets wrong. To label them:

1. Use any tool that exports **PASCAL VOC** or **YOLO**: [Label Studio](https://labelstud.io),
   [CVAT](https://www.cvat.ai) or [makesense.ai](https://www.makesense.ai)
   (browser-only, no install).
2. Create the 10 classes above, **in that order** for YOLO export (it must match
   `schematica_vision/classes.py`).
3. Box rules (the same conventions as CGHD, so the data mixes cleanly):
   - **Components:** box the symbol body, not the wire leads. The pipeline
     finds terminals by looking just *outside* the box, so a box that runs
     along the leads hides the connection.
   - **Text:** one box per value or label ("10k", "R1"), tight around the
     characters.
   - **Junction:** a small box around each dot.
   - **Crossover:** a box around the hop where two wires cross without joining.
   - **Ground:** the symbol, not the wire above it.
   - **Anything else** (diode, switch, op-amp…): `other`.
4. Put VOC exports in a folder `drafter_<you>/annotations` with the images in
   `drafter_<you>/images`, next to the CGHD drafters, and rerun
   `prepare_dataset.py`. Giving yourself a drafter id keeps your drawings
   together in one split.

## Model weights

`weights/model.onnx` is the trained detector and `weights/metrics.json`
holds its test scores (see [`weights/README.md`](weights/README.md)). The
backend loads the model at startup when the file exists. Without it, the
upload endpoint returns a clear 503 and the rest of the app works as before.

## Licences

- **Ultralytics (YOLOv8) is AGPL-3.0.** It is used only by `training/`. The
  app runs the exported ONNX file with onnxruntime (MIT), so the served code
  does not include Ultralytics. Whether the trained weights are a derivative
  work is something Ultralytics' licence FAQ takes a broad view of. That is
  fine for a portfolio project. A commercial product would buy their licence
  or train a detector with a permissive licence (for example RT-DETR in
  another framework) instead.
- RapidOCR and its PaddleOCR models are Apache-2.0.
