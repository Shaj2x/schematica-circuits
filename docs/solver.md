# Solver design

The solver (`/solver`) is a Rust library that takes a [netlist](netlist-format.md)
and returns every node voltage and branch current of a DC circuit. This note
explains how it works and why it is built this way.

## Pipeline

```
JSON ──parse──▶ Netlist ──validate + compile──▶ Circuit ──assemble──▶ A·x = z ──LU──▶ Solution
     (serde)            (circuit.rs)                     (mna.rs)           (linalg.rs)
```

| Stage | Input → output | Responsibility |
|-------|----------------|----------------|
| `netlist.rs` | JSON ↔ Rust types | The public contract. No logic. |
| `circuit.rs` | `Netlist` → `Circuit` | Reject bad input; map node names to integer indices; graph checks. |
| `mna.rs` | `Circuit` → matrix system → `Solution` | Element stamps; mapping the solution vector back to names. |
| `linalg.rs` | matrix → factors → vector | Dense LU with partial pivoting. Knows nothing about circuits. |

Each stage has one job and its own tests. The numerical code only sees a
`Circuit`, which cannot exist unless validation passed.

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
derivation. Adding capacitors and inductors in Phase 3 means writing two new
stamps, not changing the algorithm.

Ground gets no row or column. Its KCL equation is the negative sum of all the
others, so keeping it would make the matrix singular. In code, ground is
`Node = None`, and the stamping helpers skip `None` automatically.

## Error handling: graph checks before matrix math

A singular MNA matrix means the circuit has no unique solution, but
"singular matrix" is useless to a student. For linear circuits with positive
resistors, the matrix is singular exactly when one of two structural
conditions holds, and both are cheap graph checks done with union-find before
any matrix is built:

1. **Voltage-source loop.** A cycle made only of voltage sources (two in
   parallel is the smallest case). KVL around it either contradicts the source
   values or is redundant, and the loop current is undetermined. Detected by
   adding voltage sources to a union-find one at a time: a source whose
   terminals are already joined closes a loop, and it is the one reported.
2. **Floating node / current-source cut-set.** A node with no path to ground
   through resistors or voltage sources. Current sources are excluded because
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
- **Lossless JSON round trip.** This caught a real bug: serde_json's default
  float parser can be off by one unit in the last place, so
  `9.600000000000001` came back as `9.6`. The fix is the `float_roundtrip`
  feature.

## Dependencies

| Crate | Why |
|-------|-----|
| `serde` | Derive JSON (de)serialization for the netlist types. |
| `serde_json` (with `float_roundtrip`) | The JSON format itself; exact float parsing. |
| `thiserror` | Derives `Display` and `Error` for the error enum without boilerplate. |

The crate deliberately has no WebAssembly or Python dependencies. Phase 2 adds
a thin `wasm-bindgen` wrapper crate, and the backend can use a PyO3 wrapper,
so the browser and the server run the same solver.
