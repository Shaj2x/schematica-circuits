# Schematica

Turn a photo of a circuit schematic, hand-drawn or from a textbook, into an
interactive simulation, with an AI assistant that explains the solution step by
step.

> **Status:** in development. The DC solver core is done; the rest is planned.

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | DC solver core in Rust (Modified Nodal Analysis) | ✅ Done |
| 2 | WebAssembly build + React editor with live re-solve | Planned |
| 3 | Transient analysis (capacitors, inductors) | Planned |
| 4 | FastAPI backend, saved circuits, AI explanations | Planned |
| 5 | Computer vision: photo → netlist | Planned |
| 6 | Docker, CI, benchmarks | Planned |

## Repository layout

```
solver/    Rust crate: netlist format + MNA solver
docs/      Design notes
```

`frontend/`, `backend/` and `ml/` will be added in later phases.

## Solver

```sh
cargo test          # unit, fixture and error-case tests
cargo clippy --all-targets -- -D warnings
```

- [Netlist format](docs/netlist-format.md): the JSON contract shared by every component
- [Solver design](docs/solver.md): how MNA works here and why it is built this way
