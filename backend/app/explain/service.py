"""Chooses who writes explanations: Claude when configured, the template otherwise.

Either way, the result goes through the same grounding check, so the UI can
treat both sources identically.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

import anthropic

from ..analysis import NodalAnalysis
from ..check import QuantityResult
from ..config import Settings
from ..grounding import unverified_numbers
from ..schemas import Explanation
from ..units import find_quantities
from . import template
from .llm import ClaudeWriter, ExplanationFailed, MessagesClient

logger = logging.getLogger(__name__)


class Explainer:
    def __init__(self, writer: ClaudeWriter | None = None) -> None:
        self.writer = writer

    @property
    def source(self) -> str:
        return "claude" if self.writer else "template"

    def explain(self, netlist: Mapping[str, Any], analysis: NodalAnalysis) -> Explanation:
        fallback = template.explain(analysis)
        if self.writer is None:
            return fallback
        try:
            return _grounded(self.writer.explain(netlist, analysis), analysis)
        except ExplanationFailed as error:
            logger.warning("explanation fell back to template: %s", error)
            return fallback.model_copy(update={"note": f"{error}; showing the standard working instead."})

    def feedback(
        self, netlist: Mapping[str, Any], analysis: NodalAnalysis, results: list[QuantityResult]
    ) -> Explanation:
        fallback = template.feedback(results)
        if self.writer is None:
            return fallback
        try:
            return _grounded(self.writer.feedback(netlist, analysis, results), analysis, results)
        except ExplanationFailed as error:
            logger.warning("feedback fell back to template: %s", error)
            return fallback.model_copy(update={"note": f"{error}; showing the standard feedback instead."})


def _grounded(
    explanation: Explanation, analysis: NodalAnalysis, results: list[QuantityResult] | None = None
) -> Explanation:
    texts = [explanation.summary] + [f"{s.detail} {s.equation or ''}" for s in explanation.steps]
    flagged = unverified_numbers(texts, analysis)
    if results:
        # In feedback, quoting the student's own (wrong) numbers is expected.
        submitted = [r.submitted for r in results]
        flagged = [q for q in flagged if not _matches_any(q, submitted)]
    return explanation.model_copy(update={"unverified_numbers": flagged})


def _matches_any(quantity_text: str, values: list[float]) -> bool:
    found = find_quantities(quantity_text)
    return bool(found) and any(abs(abs(found[0].value) - abs(x)) <= 0.01 * abs(x) for x in values)


def make_explainer(settings: Settings, client: MessagesClient | None = None) -> Explainer:
    """Claude-backed when an API key is configured (or a client is injected)."""
    if client is None and settings.anthropic_api_key is not None:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    return Explainer(ClaudeWriter(client, settings.anthropic_model) if client else None)
