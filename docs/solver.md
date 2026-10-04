# Solver design

The solver (`/solver`) is a Rust library that takes a [netlist](netlist-format.md)
and returns every node voltage and branch current, either at DC or over time
(transient analysis). This note explains how it works and why it is built this
way.

## Pipeline

```
JSON ──parse──▶ Netlist ──validate──▶ Circuit ──analysis──▶ stamps ──checks + assemble──▶ A·x = z ──LU──▶ result
     (serde)          (circuit.rs)          (dc.rs, transient.rs)       (mna.rs)               (linalg.rs)
```

| Stage | Input → output | Responsibility |
|-------|----------------|----------------|
| `netlist.rs` | JSON ↔ Rust types | The public contract. No logic. |
| `circuit.rs` | `Netlist` → `Circuit` | Reject bad identifiers and values; map node names to integer indices. |
| `dc.rs`, `transient.rs` | `Circuit` → stamps | Decide how each element behaves in this analysis. |
| `mna.rs` | stamps → `Network` → matrix | Structural checks, assembly, right-hand side. |
| `linalg.rs` | matrix → factors → vector | Dense LU with partial pivoting. Knows nothing about circuits. |

Each stage has one job and its own tests. The numerical code only sees a
`Circuit`, which cannot exist unless validation passed.

### Analyses lower elements to three primitives

Every analysis reduces the circuit to the same three linear **stamps**: a
conductance, a current source and a voltage source. Only the translation
differs:

| Element | DC | Transient, t = 0 | Transient step |
|---------|----|------------------|----------------|
| Resistor | conductance | conductance | conductance |
| Capacitor | nothing (open) | voltage source at v(0) | conductance + history source |
| Inductor | 0 V source (short) | current source at i(0) | conductance + history source |

The structural checks and matrix assembly are written once, against stamps.
This matters because the checks really do depend on the analysis. A node
reached only through a capacitor floats at DC, where the capacitor is an open
circuit, but is perfectly well defined in a transient run. An inductor across
a voltage source is a short at DC (a voltage-source loop) but just ramps its
current linearly in a transient run. In Phase 1 the checks ran on the
netlist itself; Phase 3 moved them to the stamps for exactly this reason.

## Modified Nodal Analysis in one page

Choose a ground node (0 V). For `n` other nodes and `m` voltage sources, the
unknowns are the `n` node voltages and the `m` voltage-source currents:

```
[ G  B ] [ v ]   [ j ]      G (n×n): conductances          j: currents injected by current sources
[ C  0 ] [ i ] = [ e ]      B (n×m): ±1 where each V source connects    e: source voltages
                            C = Bᵀ
```

- **Top rows: KCL at each node.** The current leaving through resistors, plus
  the current entering voltage sources, equals the current injected by current
  sources.
- **Bottom rows: one equation per voltage source**, `v_pos − v_neg = e`.

Why "modified": plain nodal analysis only has node voltages as unknowns, and an
ideal voltage source's current cannot be written in terms of node voltages.
By hand you work around it with a supernode. MNA instead makes that current an
unknown, which handles any source placement uniformly and also hands us the
source current for free.

Each element contributes a fixed pattern of entries (a **stamp**), and the
matrix is the sum of all stamps. `mna.rs` documents each stamp with its
derivation. Capacitors and inductors did not need new stamps at all: each
analysis expresses them with the same three primitives (see the table above).

Ground gets no row or column. Its KCL equation is the negative sum of all the
others, so keeping it would make the matrix singular. In code, ground is
`Node = None`, and the stamping helpers skip `None` automatically.

## Transient analysis: companion models

A capacitor obeys i = C dv/dt and an inductor v = L di/dt. Approximating the
derivative over one step h turns each into a conductance in parallel with a
current source carrying the element's history, its *companion model*. Each
time step is then an ordinary linear solve:

| | Backward Euler | Trapezoidal |
|-|----------------|-------------|
| Capacitor | G = C/h, i₊ = G·v₊ − G·v | G = 2C/h, i₊ = G·v₊ − (G·v + i) |
| Inductor | G = h/L, i₊ = G·v₊ + i | G = h/2L, i₊ = G·v₊ + (i + G·v) |

(v, i: the element's voltage and current at the previous step; ₊: this step.)

**Why a fixed step.** G depends only on h and the component value, so with a
fixed step the matrix is identical at every step. It is LU-factored once
(O(n³)), and each step only rebuilds the right-hand side and does an O(n²)
substitution. This is why Phase 1 split `factor` from `solve`. A variable-step
solver, as SPICE uses, adapts h to how fast signals change, but it refactors
whenever h changes; it is the upgrade path if fast edges ever need it.

**Why two methods.** Backward Euler is first order and adds numerical damping;
the trapezoidal rule is second order and adds none (the SPICE default). The
tests show both properties numerically:

- Halving h on the RC charging curve halves backward Euler's maximum error
  (measured ratio 1.99) and quarters the trapezoidal rule's (4.00).
- An ideal LC tank keeps its energy to within 1e-9 for ten periods under the
  trapezoidal rule, while backward Euler loses over 90% of it.

**Initial conditions.** A run starts from the components' initial conditions
(capacitor voltage, inductor current; default 0), like a switch closing at
t = 0, instead of from a DC operating point. That is what textbook transient
problems ask for. The t = 0 point is solved with each capacitor as a voltage
source at its initial voltage and each inductor as a current source at its
initial current. That gives every node voltage at t = 0, and the capacitor
currents and inductor voltages the trapezoidal rule needs for its first step.
If that circuit has no unique solution, for example an uncharged capacitor
directly across a voltage source (it would have to charge instantly), the
solver reports `UndefinedInitialState` with the underlying cause rather than
inventing an infinite current.

## Error handling: graph checks before matrix math

A singular MNA matrix means the circuit has no unique solution, but
"singular matrix" is useless to a student. For linear circuits with positive
resistors, the matrix is singular exactly when one of two structural
conditions holds, and both are cheap graph checks done with union-find before
any matrix is built:

These run on the analysis's stamps, so "voltage source" below includes an
inductor at DC and a capacitor at t = 0.

1. **Voltage-source loop.** A cycle made only of voltage sources (two in
   parallel is the smallest case). KVL around it either contradicts the source
   values or is redundant, and the loop current is undetermined. Detected by
   adding voltage sources to a union-find one at a time: a source whose
   terminals are already joined closes a loop, and it is the one reported.
2. **Floating node / current-source cut-set.** A node with no path to ground
   through conductances or voltage sources. Current sources are excluded because
   they fix a current, not a voltage. This one check also catches current
   sources in series and subcircuits drawn but never connected.

Both checks report the specific nodes or component, which the UI can
highlight. `SingularMatrix` remains as a fallback for numerically degenerate
input, such as resistances spanning hundreds of orders of magnitude.

## Linear algebra: why hand-rolled dense LU

| Option | Verdict |
|--------|---------|
| `nalgebra` / `faer` | Excellent, but adds a dependency and WASM size for one function we can write in about 60 lines. |
| Sparse LU (what SPICE uses) | Pays off at thousands of nodes. Hand-drawn circuits have tens. |
| **Dense LU, partial pivoting** | Microseconds at this size, no dependencies, fully explainable. |

**Partial pivoting is required, not optional.** Voltage-source rows put zeros
on the diagonal (see the bottom-right `0` block above), so elimination without
row swaps divides by zero on most real circuits. `linalg.rs` has a test for
exactly this case.

**Factor and solve are separate** (`LuFactors::factor`, then `.solve(b)`).
Transient analysis with a fixed time step reuses one matrix with a new
right-hand side at every step, so it can factor once in O(n³) and solve each
step in O(n²).

If the benchmarks in Phase 6 show large circuits matter, `linalg.rs` is the
only file a sparse solver would replace.

## Testing strategy

- **13 textbook circuits** (`tests/fixtures/*.json`) with hand-derived answers;
  each fixture contains its derivation, so a reviewer can check the expected
  numbers without trusting the code.
- **Physics invariants on every fixture**, independent of the expected values:
  KCL holds at every node, and absorbed power sums to zero (Tellegen's
  theorem). A sign error in a stamp breaks these even if a fixture's expected
  value were wrong in the same way.
- **Stamp-level test** (`mna.rs`): checks the assembled matrix entry by entry
  against a hand-written MNA system.
- **One test per error variant** (`tests/errors.rs`).
- **Order independence**: reversing the component list gives the same answer.
- **Transient against closed-form solutions** (`tests/transient.rs`): RC
  charging and discharge, RL rise, an underdamped RLC step response (including
  its overshoot e^(−απ/ω_d)), an LC tank's energy, convergence order, KCL at
  every time step, and settling to the DC solution.
- **Mutation check.** Breaking the trapezoidal capacitor history term on
  purpose makes six transient tests fail, so they are sensitive to the
  details that matter.
- **Lossless JSON round trip.** This caught a real bug: serde_json's default
  float parser can be off by one unit in the last place, so
  `9.600000000000001` came back as `9.6`. The fix is the `float_roundtrip`
  feature.

## Performance

Measured on the series RLC example (1000 steps):

| Path | Time |
|------|------|
| Native solve | 0.14 ms |
| Native JSON encoding of the result | 0.25 ms |
| Browser: WASM solve + JSON both ways | ≈ 2.3 ms |

Most of the browser time is moving JSON across the WASM boundary, not the
math. That is still well inside a 16 ms frame, so the editor re-runs on every
edit. If it ever matters, returning the sample arrays as `Float64Array`s
instead of JSON would remove most of it.

## Dependencies

| Crate | Why |
|-------|-----|
| `serde` | Derive JSON (de)serialization for the netlist types. |
| `serde_json` (with `float_roundtrip`) | The JSON format itself; exact float parsing. |
| `thiserror` | Derives `Display` and `Error` for the error enum without boilerplate. |

The crate deliberately has no WebAssembly or Python dependencies. A thin
`wasm-bindgen` wrapper crate (`solver-wasm/`) serves the browser, and the
backend can use a PyO3 wrapper, so the browser and the server run the same
solver.
