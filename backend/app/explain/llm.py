"""Step-by-step explanations written by Claude, grounded in the solver's numbers.

The model never does arithmetic that matters. It receives the netlist, the
nodal-analysis working and the solution as structured context, and is asked
to explain them, not to solve the circuit. Its output must match a JSON
schema, and every value it writes is then checked against the computed
quantities (`grounding.py`).

If the call fails for any reason (network, rate limit, refusal, truncated or
malformed output), the caller falls back to the deterministic template, so
the endpoint keeps working; `Explanation.note` says why.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, Protocol

import anthropic
from pydantic import BaseModel, ValidationError

from ..analysis import NodalAnalysis
from ..check import QuantityResult
from ..schemas import Explanation, Step
from ..units import format_value

#: The model's output: what `Explanation` needs, minus what the server sets.
OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "equation": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
                "required": ["title", "detail", "equation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "steps"],
    "additionalProperties": False,
}

EXPLAIN_SYSTEM = """\
You are a patient teaching assistant for a first-year circuits course. You \
explain how nodal analysis solves a DC circuit, step by step, for a student \
who is learning the method.

You are given the circuit, the nodal-analysis working (the equations), and \
the solution, all computed by a circuit solver. Explain that working; do not \
re-solve the circuit or introduce values of your own. Every number you write \
must be one from the context (component values, node voltages, branch \
currents, or differences of node voltages), written with SI prefixes and \
units, for example 6.67 V or 3.33 mA. Refer to nodes and components by the \
names in the context. When a step has an equation, put it in `equation` \
exactly as the working writes it or as a direct substitution of it.

Use 4 to 8 steps: the reference node and unknowns, any DC simplifications, \
the equations and why each holds, the solution, the branch currents, and a \
check. Keep each step's detail to two or three sentences of plain language."""

FEEDBACK_SYSTEM = """\
You are a patient teaching assistant for a first-year circuits course. A \
student has submitted answers for a DC circuit. You are given the circuit, \
the nodal-analysis working, the correct solution, and a per-answer \
comparison that already states which answers are wrong and the most likely \
mistake for each.

Write short, encouraging feedback: one step per wrong answer, explaining the \
likely mistake and how to fix it, and a summary. Do not recompute anything: \
use only the numbers given, with SI prefixes and units. Do not just restate \
the correct answer; say which step of the method went wrong. If every answer \
is correct, say so in the summary and return no steps."""


class _Output(BaseModel):
    summary: str
    steps: list[Step]


class ExplanationFailed(Exception):
    """The model call did not produce a usable explanation."""


class MessagesClient(Protocol):
    """The slice of `anthropic.Anthropic` this module uses (for test doubles)."""

    @property
    def beta(self) -> Any: ...


class ClaudeWriter:
    def __init__(self, client: MessagesClient, model: str) -> None:
        self.client = client
        self.model = model

    def explain(self, netlist: Mapping[str, Any], analysis: NodalAnalysis) -> Explanation:
        return self._write(EXPLAIN_SYSTEM, _context(netlist, analysis))

    def feedback(
        self, netlist: Mapping[str, Any], analysis: NodalAnalysis, results: list[QuantityResult]
    ) -> Explanation:
        context = _context(netlist, analysis)
        context["comparison"] = [
            {
                "quantity": r.label,
                "submitted": r.submitted,
                "expected": r.expected,
                "correct": r.correct,
                "likely_mistake": r.hint,
            }
            for r in results
        ]
        return self._write(FEEDBACK_SYSTEM, context)

    def _write(self, system: str, context: Mapping[str, Any]) -> Explanation:
        try:
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=8000,
                system=system,
                messages=[{"role": "user", "content": json.dumps(context, indent=2)}],
                output_config={
                    # Explaining given working is not a hard reasoning task.
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA},
                },
                # If a safety classifier declines, retry on Anthropic's
                # recommended fallback model rather than failing outright.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as error:
            raise ExplanationFailed(f"Claude API error: {type(error).__name__}") from error

        if response.stop_reason == "refusal":
            raise ExplanationFailed("Claude declined to answer")
        if response.stop_reason == "max_tokens":
            raise ExplanationFailed("Claude's answer was cut off")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise ExplanationFailed("Claude returned no text")
        try:
            output = _Output.model_validate_json(text)
        except ValidationError as error:
            raise ExplanationFailed("Claude's answer did not match the schema") from error
        return Explanation(source="claude", model=response.model, summary=output.summary, steps=output.steps)


def _context(netlist: Mapping[str, Any], analysis: NodalAnalysis) -> dict[str, Any]:
    """Everything the model may use, with values pre-formatted the way it should write them."""
    return {
        "netlist": netlist,
        "ground": analysis.ground,
        "unknown_nodes": list(analysis.nodes),
        "dc_notes": list(analysis.notes),
        "working": [
            {"kind": e.kind, "nodes": list(e.nodes), "equation": e.text, "sources": list(e.sources)}
            for e in analysis.equations
        ],
        "solution": {
            "node_voltages": {n: format_value(v, "V") for n, v in analysis.node_voltages.items()},
            "branch_currents": {c: format_value(i, "A") for c, i in analysis.branch_currents.items()},
        },
        "sign_convention": (
            "A positive branch current flows from the component's first terminal to its second "
            "(a to b; pos to neg through a voltage source; from to to for a current source)."
        ),
    }
