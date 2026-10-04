# Frontend design

The frontend (`/frontend`) is a React + TypeScript app where users draw a DC
circuit on a grid, solve it with the Rust solver compiled to WebAssembly, and
read voltages and currents by hovering.

## Data flow

```
 pointer / keyboard
        │
        ▼
  editorReducer ──► Schematic ──buildNetlist──► Netlist ──solver.solve──► SolveResult
 (schematic/editor)   (geometry)  (schematic/netlist)  (contract)   (WASM)        │
                                       │                                         │
                                       └── nodeOfPoint, nodeOfWire ──────────────┤
                                                                                 ▼
                                                    Canvas hover readouts, Results tables
```

Each arrow is a pure function except the solve call, which is deterministic
too. React only holds the state and renders it.

| Module | Responsibility | Tested by |
|--------|----------------|-----------|
| `schematic/model.ts` | Document types: parts, wires, grounds on an integer grid | — |
| `schematic/editor.ts` | Every edit as a reducer action | `editor.test.ts` |
| `schematic/netlist.ts` | Geometry → nodes → netlist | `netlist.test.ts` |
| `solver/` | Typed wrapper around the WASM module | `wasm.test.ts` |
| `units.ts` | Engineering notation (4.7k ↔ 4700) | `units.test.ts` |
| `editor/` | React components: canvas, toolbar, inspector, results | `App.test.tsx` |

## Key decisions

### The schematic is not the netlist

The editor stores *geometry*: a resistor from (3, 4) to (5, 4), a wire from
(5, 4) to (5, 8). Nodes are *derived* from that geometry on every change. The
alternative, having the user's actions edit a netlist directly, would mean
keeping node membership in sync through every move, delete and rewire, which
is a classic source of bugs. Deriving it makes the netlist always consistent
with what is drawn. This is also exactly the problem the Phase 5 CV pipeline
solves (photo geometry → netlist), so the same idea appears twice.

**Connection rules** (`netlist.ts`): wires join their endpoints; a wire joins
any terminal or wire end lying in its interior (a T-junction); wires that only
cross do not connect; all ground symbols are one node. Union-find over
connection points implements this, the same structure the Rust solver uses for
its floating-node check. Points with three or more connections get a junction
dot, and points with only one get a hollow circle, so a missing connection is
visible before solving.

### All editing logic is a pure reducer

Placing, wiring, rotating, flipping, editing values and deleting are actions on
`editorReducer`. They are tested as plain function calls ("with the wire tool,
click (0,0), then (4,0), then Escape") without rendering anything. The canvas
only converts pointer positions to grid points and dispatches actions.

### Solve synchronously on every change

A WASM solve of an editor-sized circuit, including the JSON round trip, takes
about 0.02 ms once warmed up, and deriving the netlist from the drawing about
the same (measured on the six-resistor Wheatstone example in Node). That is
hundreds of times below one 16 ms frame. So
the app re-solves inside a `useMemo` on every edit and every slider tick, with
no debouncing and no Web Worker. Both would add complexity for no visible
benefit at this size. The measured time is shown in the results panel, so the
claim stays checkable. If Phase 3 transient runs get slow, a worker is the
first thing to add.

### The solver is injected, not imported

`App` receives a `Solver` as a prop. In the browser `Root` loads the WASM
module over the network; in tests `testSolver()` instantiates it from the
`.wasm` file on disk. Components never deal with async loading, and the
UI tests run the *real* solver rather than a mock.

### JSON strings across the WASM boundary

`solve(json) -> json`, with errors returned in an `{ ok, solution | error }`
envelope rather than thrown. The netlist is already a JSON contract, so this
adds no new format and no dependency (such as `serde-wasm-bindgen`). TypeScript
gets a discriminated union instead of try/catch, and the envelope can be
returned unchanged by the backend later.

### Hand-written TypeScript types, checked against Rust

`solver/types.ts` mirrors the Rust types by hand. Drift is caught by
`wasm.test.ts`, which runs every Rust fixture and one netlist per error kind
through the real WASM build; the error cases are a `Record<SolverErrorKind, …>`
so a new kind without a test fails type checking. Code generation (`ts-rs`,
`tsify`) is the upgrade path if the contract grows.

### Structured errors become highlights

Solver errors carry the offending node names or component id. `diagnose.ts`
turns them into a plain-English message plus the parts and nodes to draw in
red. For example, two voltage sources in parallel highlight the one that
closes the loop.

### Logarithmic value slider

Component values span decades (10 Ω to 1 MΩ). The slider covers 0.1× to 10×
of the value it was centred on and re-centres when released, so it can travel
any distance in a few drags while staying precise near the current value.

## Build

`npm run build:wasm` runs wasm-pack on `../solver-wasm` and writes the
package to `src/solver/pkg/` (generated, not committed). `dev` and `build` run
it first. wasm-pack's optimizer, `wasm-opt`, comes from the pinned `binaryen`
npm package, because older system releases miscompile wasm-bindgen's externref
table. A test caught this as a `Table.grow` failure on load.

Production bundle: about 74 KB gzipped WASM and 79 KB gzipped JS.

## Known limitations

- Parts cannot be dragged; delete and re-place instead.
- No undo yet. The reducer design makes it straightforward (keep a stack of past
  `schematic` values).
- Hover readouts need a pointer. The results tables list every value for
  keyboard and touch users.
