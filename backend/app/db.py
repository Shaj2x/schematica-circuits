"""Database engine, ORM base and the per-request session dependency."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def make_sessionmaker(database_url: str) -> sessionmaker[Session]:
    engine: Engine = create_engine(database_url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_session(request: Request) -> Iterator[Session]:
    """One session per request, committed by the route, always closed."""
    factory: sessionmaker[Session] = request.app.state.sessionmaker
    with factory() as session:
        yield session
