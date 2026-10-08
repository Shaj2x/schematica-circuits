"""The FastAPI application.

`create_app` takes its dependencies as arguments (settings, database
sessions, explainer, recognizer) so tests can pass in a test database, a fake
Claude client and a fake detector without monkeypatching globals.
"""

from __future__ import annotations

import schematica_solver
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, sessionmaker

from .config import Settings, get_settings
from .db import make_sessionmaker
from .explain import Explainer, make_explainer
from .recognition import Recognizer, make_recognizer
from .routes import analysis, circuits, recognize
from .schemas import Health


def create_app(
    settings: Settings | None = None,
    session_factory: sessionmaker[Session] | None = None,
    explainer: Explainer | None = None,
    recognizer: Recognizer | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Schematica API", version="0.1.0")
    app.state.settings = settings
    app.state.sessionmaker = session_factory or make_sessionmaker(settings.database_url)
    app.state.explainer = explainer or make_explainer(settings)
    app.state.recognizer = recognizer or make_recognizer(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(schematica_solver.SolverError)
    def solver_error(_: Request, error: schematica_solver.SolverError) -> JSONResponse:
        # A circuit that cannot be solved is a client error with structure the
        # UI uses for highlighting, not a server failure.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"error": error.detail}
        )

    @app.get("/api/health", response_model=Health)
    def health() -> Health:
        return Health(
            status="ok", explanations=app.state.explainer.source, recognition=app.state.recognizer.available
        )

    app.include_router(circuits.router)
    app.include_router(analysis.router)
    app.include_router(recognize.router)
    return app
