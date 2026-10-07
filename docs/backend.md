# Backend design

The backend (`/backend`) is a FastAPI service that stores circuits in
Postgres, solves them with the same Rust solver the browser uses, and
explains solutions step by step. Explanations come from Claude when an API
key is configured, and from a deterministic template otherwise.

## Request flow

```
POST /api/explain {netlist}
  └─ solving.py      Rust solver via Python binding (never trust client numbers)
  └─ analysis.py     nodal-analysis working: fixed nodes, supernodes, KCL equations
  └─ explain/        template, or Claude with structured output
       └─ grounding.py   flag any value the text states that the solver did not compute
```

| Module | Responsibility |
|--------|----------------|
| `main.py` | `create_app(settings, session_factory, explainer)`: dependencies are passed in, so tests swap in a test database and a fake Claude client. |
| `routes/circuits.py` | CRUD for saved circuits, plus their analysis history. |
| `routes/analysis.py` | `/solve`, `/solve/transient`, `/explain`, `/check`. |
| `solving.py` | Server-side solving with a size limit; maps solver errors to 422. |
| `analysis.py` | Builds the working a student would write by hand. |
| `check.py` | Compares submitted answers and diagnoses the likely mistake. |
| `grounding.py` | Checks every number in generated text against the solution. |
| `explain/template.py` | Deterministic explanations and feedback. |
| `explain/llm.py` | The Claude call: prompt, schema, failure handling. |
| `explain/service.py` | Chooses Claude or the template; applies grounding. |

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Status, and whether explanations come from `template` or `claude`. |
| POST | `/api/solve` | DC solution, or `422 {"error": {...}}` with the structured solver error. |
| POST | `/api/solve/transient` | Transient run; same error shape. |
| POST/GET | `/api/circuits` | Save; list (newest first, `limit`/`offset`). |
| GET/PUT/DELETE | `/api/circuits/{id}` | Read, replace, delete. |
| GET | `/api/circuits/{id}/history` | Explanations and checks run on a saved circuit. |
| POST | `/api/explain` | `{netlist}` or `{circuit_id}` → solution and step-by-step explanation. |
| POST | `/api/check` | Target plus `{answers: {node_voltages, branch_currents}}` → per-answer results and feedback. |

FastAPI also serves interactive docs at `/docs`.

## Key decisions

### The server solves; it never trusts client numbers

The browser has already solved the circuit, but `/explain` and `/check`
solve it again on the server with the Python binding of the same Rust crate
(`solver-py`, built with PyO3 and maturin). A modified or buggy client cannot
make the explanation describe wrong numbers. Both bindings return the result
envelope built by `schematica_solver::envelope` in the core crate, so they
cannot disagree about the shape of a result. The binding releases the GIL
while solving, so FastAPI's threadpool keeps serving other requests.

### The working is computed, and the model only explains it

`analysis.py` turns a netlist into the steps a student writes by hand:

- nodes fixed by sources connected to ground;
- supernodes for floating voltage sources, with their constraint equations;
- the KCL equation at every remaining node (inductors are shorts and
  capacitors are open at DC).

A test checks every one of the 13 textbook fixtures: the solver's solution
satisfies every equation, and the equations cover every unknown exactly once.
The model is given this working and asked to *explain* it, not to solve the
circuit. That plays to what language models are good at (clear teaching
prose) and away from what they are unreliable at (arithmetic).

### Grounding check

After generation, every value with a unit in the text ("6.67 V", "3.33 mA")
is compared with what the circuit contains: component values, node voltages
and their differences, branch currents, powers, and series and parallel pairs
of resistors. Anything that matches nothing is returned in
`unverified_numbers`, and the UI shows it as a warning above the steps.
Tolerance is 1%, so values rounded to three significant figures pass. The
check errs toward flagging: a correct value the model derived some other way
is flagged too, which is the safe direction.

### Graceful degradation

With no `ANTHROPIC_API_KEY`, the template writes explanations from the same
working. With a key, any failure, whether a network error, rate limit,
refusal, truncated output or output that does not match the schema, falls
back to the template with a `note` explaining why. The endpoints never fail
because the model did.

### The Claude call

- **Model:** `claude-opus-5-5`, overridable with `ANTHROPIC_MODEL`.
- **Structured output:** `output_config.format` with a JSON schema (summary
  plus steps). The response is validated again with Pydantic.
- **Effort `medium`:** explaining given working is not a hard reasoning task.
- **Refusal fallbacks:** `fallbacks: "default"` with the
  `server-side-fallback-2026-07-01` beta. If a safety classifier declines,
  the API retries on Anthropic's recommended fallback model instead of
  failing.
- **No sampling parameters:** current models reject `temperature`.

The request shape is checked by tests against a fake client. It has not yet
been exercised against the live API, because no key is configured yet.

### Check my work is deterministic first

`check.py` decides right or wrong (1% tolerance) and recognizes common
mistakes without any model:

| Mistake | How it is detected |
|---------|-------------------|
| Wrong sign | answer ≈ −expected |
| Unit prefix | answer / expected ≈ 10^±3k |
| Voltage across a part instead of to ground | answer ≈ v(node) − v(neighbor) |
| Another part's current | \|answer\| ≈ \|current of another part\| |
| Otherwise | evaluates the KCL equation at that node using the student's own values and reports the imbalance |

With Claude configured, the model receives this diagnosis and rewords it
into friendlier feedback. It cannot invent a different mistake.

### The netlist is a JSONB document, validated by Rust

A netlist is always read and written whole, it is versioned, and only the
solver interprets it, so it is stored as a JSONB column rather than
normalized into component and node tables. The API does not re-declare the
netlist schema in Pydantic. The Rust solver owns that contract, and a second
definition could drift. Saving rejects only *malformed* netlists (parse
errors, unknown version). An unsolvable circuit, such as one with no ground
yet, is a work in progress worth saving.

### Tests use real Postgres, through the real migrations

The test database is created by running the Alembic migrations, not
`create_all`, so the migrations are tested too. `test_models_and_migrations_agree`
runs `alembic check`, which fails if a model changes without a migration.
SQLite was not used, because the app relies on Postgres features (JSONB,
`jsonb_array_length`).

## Running locally

```sh
# Postgres with a database and user (any method; Docker arrives in Phase 6)
createuser -P schematica          # password: schematica
createdb -O schematica schematica
createdb -O schematica schematica_test

cd backend
cp .env.example .env              # optionally add ANTHROPIC_API_KEY
uv sync                           # also builds the Rust solver binding
uv run alembic upgrade head
uv run uvicorn app.asgi:app --reload --port 8000

uv run pytest                     # uses TEST_DATABASE_URL or the schematica_test default
uv run ruff check . && uv run mypy app
```

With the backend on port 8000, `npm run dev` in `frontend/` proxies `/api`
to it.
