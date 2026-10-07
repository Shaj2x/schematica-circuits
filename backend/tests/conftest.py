"""Test fixtures: a real Postgres database, the app, and a fake Claude client.

The database is real (not SQLite) because the app uses Postgres features
(JSONB and its functions); the schema is created by running the actual
Alembic migrations, so the migrations are tested too. Point
TEST_DATABASE_URL at a disposable database: every table is emptied
between tests.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import make_sessionmaker
from app.explain import Explainer
from app.main import create_app

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://schematica:schematica@localhost:5432/schematica_test",
)
BACKEND = Path(__file__).resolve().parent.parent
FIXTURES = BACKEND.parent / "solver" / "tests" / "fixtures"


def alembic_config() -> Config:
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    return config


@pytest.fixture(scope="session")
def session_factory() -> Iterator[sessionmaker[Session]]:
    config = alembic_config()
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    factory = make_sessionmaker(TEST_DATABASE_URL)
    yield factory
    factory.kw["bind"].dispose()


@pytest.fixture
def db(session_factory: sessionmaker[Session]) -> Iterator[sessionmaker[Session]]:
    yield session_factory
    with session_factory() as session:
        session.execute(text("TRUNCATE analysis_history, circuits"))
        session.commit()


@pytest.fixture
def settings() -> Settings:
    return Settings(database_url=TEST_DATABASE_URL, anthropic_api_key=None)


def make_client(settings: Settings, db: sessionmaker[Session], explainer: Explainer) -> TestClient:
    return TestClient(create_app(settings, db, explainer))


@pytest.fixture
def client(settings: Settings, db: sessionmaker[Session]) -> TestClient:
    """The API with template explanations (no API key), as it runs today."""
    return make_client(settings, db, Explainer())


def fixture(name: str) -> dict[str, Any]:
    """A hand-solved textbook circuit from the Rust test suite."""
    data: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text())
    return data


class FakeMessages:
    """Records `beta.messages.create` calls and replays canned responses."""

    def __init__(self, responses: list[Any]) -> None:
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeClaude:
    def __init__(self, *responses: Any) -> None:
        self.messages = FakeMessages(list(responses))
        self.beta = SimpleNamespace(messages=self.messages)


def claude_message(output: dict[str, Any] | str, stop_reason: str = "end_turn") -> SimpleNamespace:
    text_value = output if isinstance(output, str) else json.dumps(output)
    return SimpleNamespace(
        stop_reason=stop_reason,
        model="claude-opus-5-5",
        content=[SimpleNamespace(type="text", text=text_value)],
    )
