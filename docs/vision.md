# Photo to schematic

`POST /api/recognize` takes a photo of a hand-drawn circuit and returns an
editor schematic, plus everything the user should check before trusting it.
The code is in `ml/schematica_vision/`, and training is in `ml/training/`
(see [`ml/README.md`](../ml/README.md)).

```
 photo
   │ decode, cap the long side at 1600 px                     image.py
   ▼
 ink mask (adaptive threshold) ─────────────────┐             image.py
   │                                            │
   ▼                                            │
 YOLOv8 (ONNX): symbol boxes                    │             detector.py
   │                                            ▼
   ├──────────────► erase symbols, close gaps, label connected ink = nets     wires.py
   │                look just outside each box: which net touches which side
   ▼
 OCR on text boxes ─► "10k", "4k7", "R1" ─► nearest part of a compatible kind  ocr.py, values.py, pipeline.py
   │
   ▼
 snap parts to the grid, redraw each net as orthogonal wires           layout.py
   │ never touching another net; then re-derive connectivity to prove it
   ▼
 schematic + netlist + detections + warnings
```

## Key decisions

### Detect symbols, then trace wires with plain image processing

The model only answers "what symbols are where". Connectivity comes from the
pixels: erase the symbols, and each connected blob of remaining ink is a
net. A part's terminals are the nets that touch thin strips just outside its
box. An elongated box runs along its long side. Only near-square symbols,
such as source circles, are oriented by which pair of opposite sides the
wires touch. Counting ink for every part let a handwritten value above a
resistor outvote its wires whenever the detector missed the text.

An end-to-end model that predicts the circuit graph directly exists in the
research literature, but it needs graph-labelled training data and is hard to
debug. Splitting the job means the learned part is a standard detection
problem with a public dataset. The wiring step is deterministic, explainable,
and testable without a model. When it gets a circuit wrong, the overlay shows
which stage failed.

### Our classes, including `other`

CGHD has about 45 symbol classes. We train on 10: the five parts the solver
simulates, ground, the junction and crossover marks wire tracing needs, text,
and **`other` for every symbol we cannot simulate**. Without `other`, an
op-amp would be invisible: its box would not be erased, its pins would be
traced as wire, and the result would be a silently wrong circuit. With
`other`, the app says "a symbol it can't simulate was left out" and marks it
red on the photo.

### Split by drafter

CGHD has many drawings per person. The test set is whole drafters that never
appear in training. A random image split would let the model see each test
drafter's handwriting during training, and the score would overstate how
well it reads a new user's drawing. This is the number that would be wrong in
an interview if it were done the other way.

### Train with Ultralytics, serve with onnxruntime

`train.py` exports to ONNX. `detector.py` runs it with onnxruntime and does
the two things Ultralytics would otherwise do: letterboxing, and decoding the
`(1, 4 + classes, anchors)` output with per-class NMS. That keeps PyTorch
(about 1 GB) and Ultralytics' AGPL licence out of the backend image. `train.py`
evaluates the exported ONNX file as well as the checkpoint, so the reported
scores describe the file the app actually loads. The class names are stored
in the ONNX metadata and checked at startup, so a model trained with a
different class order fails loudly instead of mislabelling every part.

### Redraw the wires, don't copy them

Snapping hand-drawn strokes to a grid gives staircases and accidental
contacts. Instead, each part is placed where it was drawn (snapped), and each
net is redrawn as a minimum spanning tree of orthogonal wires between its
terminals. Each tree edge tries a straight run, two L shapes, then Z-shaped
detours. The editor connects anything that touches (a wire through a
terminal, a wire ending on another wire), so any route that would touch
another net's wire or terminal is rejected.

Hand drawings are spread out, and snapping at part size can give a layout 40
columns wide that is mostly empty. Runs of more than three empty columns or
rows are closed up to three. The x and y remaps are monotone and keep every
small gap exactly, so parts keep their length, wires stay orthogonal, and
whether a point lies on a wire does not change.

After routing and compression, the layout is run back through `connectivity()`, a Python port
of the editor's connection rules. That checks every traced net became exactly
one editor node and no two nets merged. Any part whose wiring could not be
drawn safely is named in an `unrouted` warning instead of being silently
mis-wired.

A Python copy of the rules could drift from the TypeScript original. To
prevent that, the Python tests write `frontend/src/schematic/recognized.fixture.json`
and a frontend test checks that `buildNetlist` derives exactly the same
netlist from each schematic.

### Show the guesses

The pipeline never hides an assumption. Each one becomes a warning that
names the parts involved:

| Warning | When |
|---------|------|
| `low_confidence` | Detector confidence below 0.5 |
| `unsupported_symbol` | An `other` symbol was found and left out |
| `unconnected` | No wire found on one side of a part |
| `shorted` | Both ends of a part are on one net. Usually a symbol between them was missed and its ink joined the wires |
| `unrouted` | The wiring could not be redrawn safely |
| `default_value` | No value could be read, so the editor default was used |
| `polarity` | Always for sources: the + side and the arrow direction are not detected |
| `no_ground` | No ground symbol was found |
| `ocr_unavailable` | The OCR package is not installed |

The UI shows the detections over the photo before anything changes. After
loading, it keeps a review list in which each part id is a button that
selects that part for editing.

### Values: assigned by distance, constrained by unit

Text boxes are read by RapidOCR, PaddleOCR's recogniser run through
onnxruntime, with no PyTorch. `values.py` parses engineering notation,
including the RKM code ("4k7" = 4.7 kΩ) and common OCR slips ("10kO" for
10 kΩ). Values are matched to parts greedily over all (text, part) pairs,
nearest first, so two values between two resistors go to the resistor each is
closer to. A value with a unit only goes to a part of that kind: "100nF" is
never given to a resistor.

## Testing without a model

`synthetic.py` renders editor schematics as slightly messy drawings
(jittered strokes, wires that stop short of where they meet) with their true
bounding boxes. The pipeline tests run it with a "detector" that returns those
boxes, and assert that the recovered netlist is the same circuit as the one
drawn (`compare.difference`: same components on the same nodes, up to node
names). They cover hand-written circuits and random ladder networks. That
exercises everything after detection, in under a second, on any machine. The
real OCR is also tested on rendered values.

The same renderer generates a synthetic YOLO dataset, so
`train.py --smoke` checks the whole training → export → ONNX evaluation path
in under a minute on a CPU.

## What a real model taught the pipeline

Ground-truth boxes are clean. A trained detector is not, and running a small
model trained on synthetic data through the browser turned up three failures
that the tests now cover:

- **One symbol, two labels.** NMS runs per class, so one unclear squiggle can
  come back as both a resistor and an inductor. Overlapping symbol boxes now
  keep only the most confident label.
- **Collisions in placement.** Two detections that snap to the same grid
  point used to raise an error. Placement now tries a finer grid, then nudges
  the later part to the nearest free spot.
- **Missed text.** See orientation above.

`ml/tests/test_model.py` also checks that our ONNX decoding gives the same
boxes as Ultralytics' own predictor, whenever a model file is present.

## Known limitations

- **Polarity is assumed**, not seen: + at the top or left, current arrows
  pointing up or right. Detecting it needs either orientation labels for
  sources or a small classifier on the source crop (four rotations of the
  same symbol).
- **Crossings without a hop symbol merge.** Two wires drawn straight across
  each other form one blob of ink. Junction dots and crossover hops are
  handled. A plain crossing would need skeleton-level analysis, looking at
  direction continuity through the crossing point.
- **Two-terminal parts only.** Anything else is reported as unsupported,
  which matches what the solver can simulate.
- **Layout is not the photo's exact geometry.** Parts keep their positions.
  Wires are redrawn cleanly and are not traced stroke by stroke.
