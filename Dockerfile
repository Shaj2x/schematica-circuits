# One image runs all of Schematica: the built frontend, the API, the photo
# pipeline and the database migrations. Three build stages keep compilers
# out of the final image:
#
#   web     Rust -> WebAssembly solver, then the Vite build of the frontend
#   wheel   Rust -> the solver's Python extension (maturin, abi3)
#   app     Python runtime: backend + vision pipeline + the two outputs above

ARG RUST_VERSION=1.97
ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=22

# No apt anywhere: Node is copied from its official image, maturin is a
# standalone binary, and the runtime's Python wheels bundle their native
# libraries. Fewer moving parts, and nothing fetched from distro mirrors.
FROM node:${NODE_VERSION}-bookworm-slim AS node
FROM python:${PYTHON_VERSION}-slim-bookworm AS maturin
RUN pip install --no-cache-dir "maturin>=1.9,<2"

# --- web ---------------------------------------------------------------------
FROM rust:${RUST_VERSION}-slim-bookworm AS web
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && rustup target add wasm32-unknown-unknown \
 && cargo install wasm-pack --locked --version 0.15.0
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY solver solver
COPY solver-wasm solver-wasm
COPY solver-py solver-py
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
RUN cd frontend && npm run build

# --- wheel -------------------------------------------------------------------
# abi3: one wheel for every CPython >= 3.11, built without an interpreter.
FROM rust:${RUST_VERSION}-slim-bookworm AS wheel
COPY --from=maturin /usr/local/bin/maturin /usr/local/bin/maturin
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY solver solver
COPY solver-wasm solver-wasm
COPY solver-py solver-py
RUN maturin build --release -m solver-py/Cargo.toml -o /wheels

# --- app ---------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS app
RUN pip install --no-cache-dir "uv>=0.8,<0.9"
WORKDIR /app

COPY --from=wheel /wheels /wheels
COPY ml ml
COPY backend backend
# The backend is an application, run from its directory: install only its
# dependencies (-r pyproject.toml), resolved together with the solver wheel
# and the vision package they name (--no-sources: no ../ paths in an image).
# The override drops rapidocr's GUI OpenCV for the headless build.
RUN printf 'opencv-python; sys_platform == "never"\n' > /tmp/overrides.txt \
 && uv pip install --system --no-cache --no-sources --override /tmp/overrides.txt \
      /wheels/*.whl "./ml[ocr]" -r backend/pyproject.toml

COPY --from=web /src/frontend/dist /app/static
COPY deploy/start.sh /app/start.sh

ENV STATIC_DIR=/app/static \
    PYTHONUNBUFFERED=1 \
    PORT=8000
EXPOSE 8000
RUN useradd --create-home --uid 10001 schematica
USER schematica
CMD ["/app/start.sh"]
