"""Request and response bodies for the HTTP API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: The netlist is validated by the Rust solver, the single owner of that
#: contract (docs/netlist-format.md). Re-declaring it in Pydantic would give
#: two definitions that could drift apart, so here it is just a JSON object.
Netlist = dict[str, Any]


class CircuitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    netlist: Netlist
    schematic: dict[str, Any] | None = None


class CircuitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    netlist: Netlist
    schematic: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class CircuitSummary(BaseModel):
    id: uuid.UUID
    name: str
    component_count: int
    updated_at: datetime


class CircuitTarget(BaseModel):
    """Either an inline netlist or a saved circuit to analyze."""

    netlist: Netlist | None = None
    circuit_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> CircuitTarget:
        if (self.netlist is None) == (self.circuit_id is None):
            raise ValueError("provide exactly one of `netlist` or `circuit_id`")
        return self


class Step(BaseModel):
    title: str
    detail: str
    equation: str | None = None


class Explanation(BaseModel):
    source: Literal["template", "claude"]
    model: str | None = None
    summary: str
    steps: list[Step]
    #: Values with units in the text that match nothing the solver computed.
    unverified_numbers: list[str] = []
    #: Set when Claude was configured but the template was used instead.
    note: str | None = None


class ExplainResponse(BaseModel):
    solution: dict[str, Any]
    explanation: Explanation


class Answers(BaseModel):
    node_voltages: dict[str, float] = {}
    branch_currents: dict[str, float] = {}


class CheckRequest(CircuitTarget):
    answers: Answers

    @model_validator(mode="after")
    def has_answers(self) -> CheckRequest:
        if not self.answers.node_voltages and not self.answers.branch_currents:
            raise ValueError("submit at least one node voltage or branch current")
        return self


class QuantityResultOut(BaseModel):
    kind: Literal["voltage", "current"]
    name: str
    label: str
    submitted: float
    expected: float | None
    correct: bool
    hint: str | None


class CheckResponse(BaseModel):
    all_correct: bool
    results: list[QuantityResultOut]
    feedback: Explanation


class HistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    source: str
    request: dict[str, Any]
    response: dict[str, Any]
    created_at: datetime


class Health(BaseModel):
    status: Literal["ok"]
    explanations: Literal["template", "claude"]
