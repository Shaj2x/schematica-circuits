"""Solving, explaining and checking answers."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

import schematica_solver
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..check import check_answers, results_as_dicts
from ..db import get_session
from ..explain import Explainer
from ..models import AnalysisRecord
from ..schemas import CheckRequest, CheckResponse, CircuitTarget, ExplainResponse, Netlist
from ..solving import check_size, solve, solve_and_analyze
from .circuits import get_circuit

router = APIRouter(prefix="/api", tags=["analysis"])

SessionDep = Annotated[Session, Depends(get_session)]


class SolveRequest(BaseModel):
    netlist: Netlist


class TransientRequest(BaseModel):
    netlist: Netlist
    options: dict[str, Any]


def _netlist(target: CircuitTarget, session: Session) -> tuple[Netlist, uuid.UUID | None]:
    if target.circuit_id is not None:
        return get_circuit(session, target.circuit_id).netlist, target.circuit_id
    assert target.netlist is not None  # guaranteed by CircuitTarget's validator
    return target.netlist, None


def _record(
    session: Session,
    circuit_id: uuid.UUID | None,
    kind: str,
    request: Any,
    response: BaseModel,
    source: str,
) -> None:
    """Keeps a history of analyses run on saved circuits."""
    if circuit_id is None:
        return
    session.add(
        AnalysisRecord(
            circuit_id=circuit_id,
            kind=kind,
            source=source,
            request=request,
            response=response.model_dump(mode="json"),
        )
    )
    session.commit()


@router.post("/solve")
def solve_dc(body: SolveRequest, request: Request) -> dict[str, Any]:
    return {"solution": solve(body.netlist, request.app.state.settings)}


@router.post("/solve/transient")
def solve_transient(body: TransientRequest, request: Request) -> dict[str, Any]:
    check_size(body.netlist, request.app.state.settings)
    return {"solution": schematica_solver.solve_transient(body.netlist, body.options)}


@router.post("/explain", response_model=ExplainResponse)
def explain(body: CircuitTarget, request: Request, session: SessionDep) -> ExplainResponse:
    netlist, circuit_id = _netlist(body, session)
    analysis = solve_and_analyze(netlist, request.app.state.settings)
    explainer: Explainer = request.app.state.explainer
    response = ExplainResponse(
        solution=dict(analysis.solution), explanation=explainer.explain(netlist, analysis)
    )
    _record(session, circuit_id, "explain", {}, response, response.explanation.source)
    return response


@router.post("/check", response_model=CheckResponse)
def check(body: CheckRequest, request: Request, session: SessionDep) -> CheckResponse:
    netlist, circuit_id = _netlist(body, session)
    analysis = solve_and_analyze(netlist, request.app.state.settings)
    results = check_answers(analysis, body.answers.node_voltages, body.answers.branch_currents)
    explainer: Explainer = request.app.state.explainer
    response = CheckResponse(
        all_correct=all(r.correct for r in results),
        results=results_as_dicts(results),
        feedback=explainer.feedback(netlist, analysis, results),
    )
    _record(session, circuit_id, "check", body.answers.model_dump(), response, response.feedback.source)
    return response
