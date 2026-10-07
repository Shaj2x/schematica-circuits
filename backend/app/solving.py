"""Server-side solving: the backend never trusts numbers sent by a client.

Explanations and answer checks are always grounded in a solve done here,
with the same Rust solver the browser runs (via its Python binding).
"""

from __future__ import annotations

from typing import Any

import schematica_solver
from fastapi import HTTPException, status

from .analysis import NodalAnalysis, analyze
from .config import Settings
from .schemas import Netlist

#: Errors meaning "this is not a netlist at all", as opposed to "this circuit
#: cannot be solved". Saving rejects only these: an unsolvable circuit can be
#: a work in progress worth keeping.
MALFORMED = {"parse", "unsupported_version"}


def check_size(netlist: Netlist, settings: Settings) -> None:
    components = netlist.get("components")
    if isinstance(components, list) and len(components) > settings.max_components:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"circuits are limited to {settings.max_components} components",
        )


def solve(netlist: Netlist, settings: Settings) -> dict[str, Any]:
    """Solves at DC; raises `schematica_solver.SolverError` (mapped to 422)."""
    check_size(netlist, settings)
    return schematica_solver.solve(netlist)


def solve_and_analyze(netlist: Netlist, settings: Settings) -> NodalAnalysis:
    return analyze(netlist, solve(netlist, settings))


def validate_for_storage(netlist: Netlist, settings: Settings) -> None:
    try:
        solve(netlist, settings)
    except schematica_solver.SolverError as error:
        if error.kind in MALFORMED:
            raise
