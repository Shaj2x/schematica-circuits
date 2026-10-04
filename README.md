# Schematica

Turn a photo of a circuit schematic, hand-drawn or from a textbook, into an
interactive simulation, with an AI assistant that explains the solution step by
step.

> **Status:** in development. You can draw and solve DC circuits in the browser; photo input and AI explanations are planned.

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | DC solver core in Rust (Modified Nodal Analysis) | ✅ Done |
| 2 | WebAssembly build + React editor with live re-solve | ✅ Done |
| 3 | Transient analysis (capacitors, inductors) | Planned |
| 4 | FastAPI backend, saved circuits, AI explanations | Planned |
| 5 | Computer vision: photo → netlist | Planned |
| 6 | Docker, CI, benchmarks | Planned |

## Repository layout

```
solver/        Rust crate: netlist format + MNA solver
solver-wasm/   WebAssembly bindings (wasm-bindgen)
frontend/      React + TypeScript editor
docs/          Design notes
```

`backend/` and `ml/` will be added in later phases.

## Running it

Requirements: Rust (with the `wasm32-unknown-unknown` target), wasm-pack and Node 22.12+ (required by Vite 8).

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

cd frontend
npm install
npm run dev          # builds the WASM solver, then starts Vite on http://localhost:5173
```

## Tests and checks

```sh
cargo test                                   # solver: fixtures, error cases, WASM envelope
cargo clippy --all-targets -- -D warnings

cd frontend
npm test             # reducer, netlist derivation, units, WASM contract, UI
npm run typecheck
npm run lint
```

The frontend tests load the real WASM build (`npm run build:wasm` first). They
re-run the Rust fixtures through it, so the browser and native builds are
checked against the same hand-derived answers.

## Design notes

- [Netlist format](docs/netlist-format.md): the JSON contract shared by every component
- [Solver design](docs/solver.md): how MNA works here and why it is built this way
- [Frontend design](docs/frontend.md): schematic → netlist, the editor reducer, live solving

## License

[MIT](LICENSE)
