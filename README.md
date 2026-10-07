# Schematica

Turn a photo of a circuit schematic, hand-drawn or from a textbook, into an
interactive simulation, with an AI assistant that explains the solution step by
step.

> **Status:** in development. You can draw circuits, solve them at DC or over time with live plots, save them, get step-by-step explanations and check your own answers. Photo input is next.

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | DC solver core in Rust (Modified Nodal Analysis) | ✅ Done |
| 2 | WebAssembly build + React editor with live re-solve | ✅ Done |
| 3 | Transient analysis (capacitors, inductors) | ✅ Done |
| 4 | FastAPI backend, saved circuits, AI explanations | ✅ Done (Claude-written explanations switch on with an API key) |
| 5 | Computer vision: photo → netlist | Planned |
| 6 | Docker, CI, benchmarks | Planned |

## Repository layout

```
solver/        Rust crate: netlist format + MNA solver
solver-wasm/   WebAssembly bindings (wasm-bindgen), for the browser
solver-py/     Python bindings (PyO3), for the backend
frontend/      React + TypeScript editor
backend/       FastAPI + Postgres: saved circuits, explanations, check my work
docs/          Design notes
```

`ml/` (photo to netlist) will be added in Phase 5.

## Running it

Requirements: Rust (with the `wasm32-unknown-unknown` target), wasm-pack and Node 22.12+ (required by Vite 8).

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

cd frontend
npm install
npm run dev          # builds the WASM solver, then starts Vite on http://localhost:5173
```

The editor and simulation run entirely in the browser. Saving circuits,
explanations and check my work need the backend (Python 3.11+, uv, Postgres);
see [docs/backend.md](docs/backend.md#running-locally). Explanations work
without an API key, from a deterministic template. Set `ANTHROPIC_API_KEY`
in `backend/.env` to have Claude write them instead.

## Tests and checks

```sh
cargo test                                   # solver: fixtures, errors, transient vs exact solutions
cargo clippy --all-targets -- -D warnings

cd frontend
npm test             # reducer, netlist derivation, units, WASM contract, UI
npm run typecheck
npm run lint

cd backend
uv run pytest        # needs Postgres (see docs/backend.md)
uv run ruff check . && uv run mypy app
```

The frontend tests load the real WASM build (`npm run build:wasm` first). They
re-run the Rust fixtures through it, so the browser and native builds are
checked against the same hand-derived answers.

## Design notes

- [Netlist format](docs/netlist-format.md): the JSON contract shared by every component
- [Solver design](docs/solver.md): how MNA works here and why it is built this way
- [Frontend design](docs/frontend.md): schematic → netlist, the editor reducer, live solving
- [Backend design](docs/backend.md): server-side solving, the nodal-analysis working, grounded explanations

## License

[MIT](LICENSE)
