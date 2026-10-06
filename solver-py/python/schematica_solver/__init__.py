"""Typed Python API over the Rust circuit solver.

The native module speaks JSON strings and returns a result envelope
(``{"ok": true, "solution": ...}`` or ``{"ok": false, "error": ...}``). This
wrapper turns that into Python values: a solution dict on success, or a
raised :class:`SolverError` carrying the structured error.
"""

from __future__ import annotations

import json
from typing import Any

from . import _native

__all__ = ["NETLIST_VERSION", "SolverError", "solve", "solve_transient"]

NETLIST_VERSION: int = _native.netlist_version()


class SolverError(Exception):
    """A circuit the solver cannot solve, with its structured detail.

    ``detail`` is the error object from the contract, for example
    ``{"kind": "floating_nodes", "nodes": ["x"], "message": "..."}``.
    """

    def __init__(self, detail: dict[str, Any]) -> None:
        super().__init__(detail.get("message", detail.get("kind", "solver error")))
        self.detail = detail

    @property
    def kind(self) -> str:
        return str(self.detail.get("kind"))


def _unwrap(envelope_json: str) -> dict[str, Any]:
    envelope = json.loads(envelope_json)
    if envelope["ok"]:
        return envelope["solution"]
    raise SolverError(envelope["error"])


def solve(netlist: dict[str, Any]) -> dict[str, Any]:
    """Solves a DC netlist. Returns ``{"node_voltages": ..., "branch_currents": ...}``."""
    return _unwrap(_native.solve(json.dumps(netlist)))


def solve_transient(netlist: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    """Runs a transient analysis. Returns ``{"time": [...], "node_voltages": ..., ...}``."""
    return _unwrap(_native.solve_transient(json.dumps(netlist), json.dumps(options)))
