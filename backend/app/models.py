"""ORM models: saved circuits and the history of analyses run on them."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Circuit(Base):
    __tablename__ = "circuits"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    # The netlist is stored as JSONB rather than normalized into
    # component/node tables. It is always read and written whole, the Rust
    # solver is the only thing that interprets it, and its format is
    # versioned, so a document column fits better than relational tables.
    netlist: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Editor geometry (where parts are drawn), so a saved circuit reopens
    # exactly as drawn. Optional: a netlist from the CV pipeline has none.
    schematic: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True
    )

    history: Mapped[list[AnalysisRecord]] = relationship(
        back_populates="circuit",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="AnalysisRecord.created_at.desc()",
    )


class AnalysisRecord(Base):
    """One explanation or check-my-work request against a saved circuit."""

    __tablename__ = "analysis_history"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    circuit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("circuits.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # "explain" | "check"
    source: Mapped[str] = mapped_column(String(20))  # "template" | "claude"
    request: Mapped[dict[str, Any]] = mapped_column(JSONB)
    response: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    circuit: Mapped[Circuit] = relationship(back_populates="history")
