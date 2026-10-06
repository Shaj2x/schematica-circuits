"""Saved circuits: create, list, read, replace, delete, and their history."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import AnalysisRecord, Circuit
from ..schemas import CircuitCreate, CircuitOut, CircuitSummary, HistoryEntry
from ..solving import validate_for_storage

router = APIRouter(prefix="/api/circuits", tags=["circuits"])

SessionDep = Annotated[Session, Depends(get_session)]


def get_circuit(session: Session, circuit_id: uuid.UUID) -> Circuit:
    circuit = session.get(Circuit, circuit_id)
    if circuit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "circuit not found")
    return circuit


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CircuitOut)
def create_circuit(body: CircuitCreate, request: Request, session: SessionDep) -> Circuit:
    validate_for_storage(body.netlist, request.app.state.settings)
    circuit = Circuit(name=body.name, netlist=body.netlist, schematic=body.schematic)
    session.add(circuit)
    session.commit()
    return circuit


@router.get("", response_model=list[CircuitSummary])
def list_circuits(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[CircuitSummary]:
    count = func.jsonb_array_length(Circuit.netlist["components"])
    rows = session.execute(
        select(Circuit.id, Circuit.name, count, Circuit.updated_at)
        .order_by(Circuit.updated_at.desc(), Circuit.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return [CircuitSummary(id=r[0], name=r[1], component_count=r[2], updated_at=r[3]) for r in rows]


@router.get("/{circuit_id}", response_model=CircuitOut)
def read_circuit(circuit_id: uuid.UUID, session: SessionDep) -> Circuit:
    return get_circuit(session, circuit_id)


@router.put("/{circuit_id}", response_model=CircuitOut)
def replace_circuit(
    circuit_id: uuid.UUID, body: CircuitCreate, request: Request, session: SessionDep
) -> Circuit:
    circuit = get_circuit(session, circuit_id)
    validate_for_storage(body.netlist, request.app.state.settings)
    circuit.name = body.name
    circuit.netlist = body.netlist
    circuit.schematic = body.schematic
    session.commit()
    session.refresh(circuit)
    return circuit


@router.delete("/{circuit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_circuit(circuit_id: uuid.UUID, session: SessionDep) -> Response:
    session.delete(get_circuit(session, circuit_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{circuit_id}/history", response_model=list[HistoryEntry])
def circuit_history(circuit_id: uuid.UUID, session: SessionDep) -> list[AnalysisRecord]:
    return get_circuit(session, circuit_id).history
