# Benchmarks

Three questions, each with a script to reproduce the answer:

1. **Is it right?** Agreement with ngspice, the reference open-source SPICE simulator.
2. **Is it fast enough?** Solve time against circuit size, native and in the browser.
3. **Does photo input work?** Symbol detection accuracy on handwriting the model never saw.

Machine for the timing numbers: 4-core Intel Xeon @ 2.30 GHz (a cloud VM),
Rust 1.97 (`--release`), Node 22.22. Times are medians of repeated runs
(at least 5, and at least 300 ms of work per row).

## Accuracy against ngspice

`bench/compare_ngspice.py` translates each netlist into a SPICE deck, runs
both simulators and compares every node voltage and voltage-source current.
Errors are relative to the largest magnitude in each circuit (1 mV off in a
10 V circuit is 1e-4).

```sh
cd backend && uv run python ../bench/compare_ngspice.py --random 200
```

Reference: **ngspice 41**.

**DC operating point**

| Circuits | Count | Worst relative error | Median |
|----------|------:|---------------------:|-------:|
| Hand-solved fixtures | 13 | 2.4e-09 | 1.2e-16 |
| Random networks (3–25 nodes, values over four decades, mixed sources) | 200 | 4.5e-09 | 2.0e-09 |

Both simulators solve the same linear system exactly, so the residual is
ngspice's own `gmin`: it adds 1e-12 S from every node to ground for
numerical robustness. The fixtures where it doesn't matter agree to 1e-16,
which is machine precision.

**Transient**: ngspice runs with `uic` (start from the given initial
conditions, as Schematica does) and a maximum step equal to Schematica's
fixed step. Values are the worst error over every time point, relative to
the signal's peak.

| Circuit | Steps | Trapezoidal | Backward Euler |
|---------|------:|------------:|---------------:|
| RC charging, C starts at 1 V | 1000 | 4.4e-07 | 7.4e-04 |
| RL current rise | 1000 | 5.5e-07 | 9.2e-04 |
| Series RLC, underdamped ringing | 10000 | 2.3e-07 | 2.3e-03 |
| Two-stage RC with a current source | 1000 | 2.9e-05 | 4.2e-03 |

Trapezoidal integration (Schematica's default) matches ngspice to better
than 3e-5. Backward Euler differs by about 1e-3. That is not a bug: it is a
first-order method compared against ngspice's second-order default, and the
gap is the expected O(h) truncation error. It is why trapezoidal is the
default. (Accuracy against exact analytic solutions is tested separately in
`solver/tests/transient.rs`.)

## Solve time against circuit size

```sh
cargo run --release -p schematica-solver --example bench      # native
node bench/wasm_speed.mjs                                      # WebAssembly (after npm run build:wasm)
```

DC: an n × n mesh of 1 kΩ resistors driven at one corner. Transient: an RC
ladder of n stages, 1000 trapezoidal steps. WebAssembly times include the
JSON round trip, because that is how the editor calls the solver.

**DC operating point**

| Nodes | Components | Native | WebAssembly |
|------:|-----------:|-------:|------------:|
| 10 | 14 | 6.2 µs | 39 µs |
| 26 | 42 | 22 µs | 96 µs |
| 65 | 114 | 89 µs | 0.29 ms |
| 145 | 266 | 0.39 ms | 0.95 ms |
| 257 | 482 | 1.12 ms | 2.46 ms |
| 530 | 1014 | 5.20 ms | 8.19 ms |
| 1025 | 1986 | 21.4 ms | 31.7 ms |

**Transient, 1000 steps**

| Nodes | Components | Native | WebAssembly |
|------:|-----------:|-------:|------------:|
| 3 | 3 | 0.09 ms | 1.35 ms |
| 12 | 21 | 0.58 ms | 7.8 ms |
| 27 | 51 | 2.4 ms | 19 ms |
| 52 | 101 | 8.4 ms | 42 ms |
| 102 | 201 | 31 ms | 104 ms |
| 202 | 401 | 116 ms | 259 ms |

What the numbers say:

- **Editor-sized circuits solve in tens of microseconds**, even in the
  browser. That is why the editor re-solves on every edit and every slider
  tick with no debouncing or Web Worker (see `docs/frontend.md`): a
  10–50 node circuit costs well under 1% of a 16 ms frame.
- **DC grows roughly as n²** over this range, below the n³ that dense LU
  costs in theory: up to ~1000 nodes the matrix still fits in cache. A
  sparse LU is the upgrade path past a few thousand nodes. Hand-drawn
  circuits are nowhere near that, so the dense solver's simplicity wins
  here.
- **Transient cost is dominated by output, not solving.** The matrix is
  factored once (the time step is fixed), so each step is one O(n²)
  back-substitution. In WebAssembly most of the time is serialising
  1000 × (nodes + components) samples to JSON; for small circuits that is
  15× the native time. Typed arrays across the boundary are the fix if long
  runs ever feel slow.

## Symbol detection

`ml/training/train.py` evaluates the exported ONNX model, the file the
backend actually runs, on the held-out **test drafters**: people whose
handwriting is not in the training set (see `ml/README.md`). It writes
`ml/weights/metrics.json`, and this prints the table:

```sh
python bench/detection_report.py
```

**Pending a training run.** Training needs a GPU and the CGHD dataset, so it
runs on Colab (`ml/training/colab.ipynb`, about an hour on a T4). The table
goes here when `metrics.json` is committed.

The training, export and evaluation path itself is verified: a small model
trained for 40 CPU epochs on synthetic drawings reached mAP@50 0.50 on its
own test split. That only proves the scripts work, not the real model's
accuracy, and the ONNX decoder in the backend matches Ultralytics' own
predictions box for box (`ml/tests/test_model.py`).
