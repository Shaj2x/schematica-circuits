"""Template explanations, and the Claude path against a fake client.

No test calls the real API: the fake records the request so we can check
exactly what would be sent, and replays canned responses (including
failures) to exercise every fallback path.
"""

from __future__ import annotations

import json

import anthropic
import httpx2
import schematica_solver

from app.analysis import NodalAnalysis, analyze
from app.check import check_answers
from app.config import Settings
from app.explain import Explainer, make_explainer
from app.explain.llm import OUTPUT_SCHEMA, ClaudeWriter
from app.explain.template import explain as template_explain
from app.grounding import unverified_numbers

from .conftest import FakeClaude, claude_message, fixture


def divider() -> tuple[dict, NodalAnalysis]:  # type: ignore[type-arg]
    netlist = fixture("voltage_divider_unequal")["netlist"]
    return netlist, analyze(netlist, schematica_solver.solve(netlist))


GOOD_OUTPUT = {
    "summary": "The output sits at 8 V and 2 mA flows around the loop.",
    "steps": [
        {"title": "Reference", "detail": "Ground is 0 V; v(in) = 12 V from V1.", "equation": None},
        {
            "title": "KCL at out",
            "detail": "Currents leaving out sum to zero.",
            "equation": "(v(out) − 12 V) / 2 kΩ + v(out) / 4 kΩ = 0",
        },
        {"title": "Solve", "detail": "So v(out) = 8 V and 2 mA flows.", "equation": None},
    ],
}


def test_template_explains_with_grounded_numbers_only() -> None:
    for name in (
        "voltage_divider_unequal",
        "floating_voltage_source",
        "mixed_sources",
        "r2r_ladder",
    ):
        netlist = fixture(name)["netlist"]
        analysis = analyze(netlist, schematica_solver.solve(netlist))
        e = template_explain(analysis)
        assert e.source == "template" and len(e.steps) >= 4
        texts = [e.summary] + [f"{s.detail} {s.equation or ''}" for s in e.steps]
        assert unverified_numbers(texts, analysis) == [], name


def test_without_a_key_the_template_is_used() -> None:
    explainer = make_explainer(Settings(anthropic_api_key=None))
    assert explainer.source == "template"
    _, analysis = divider()
    assert explainer.explain({}, analysis).source == "template"


def test_claude_request_is_grounded_structured_and_uses_the_configured_model() -> None:
    fake = FakeClaude(claude_message(GOOD_OUTPUT))
    explainer = Explainer(ClaudeWriter(fake, "claude-opus-5-5"))
    netlist, analysis = divider()

    explanation = explainer.explain(netlist, analysis)

    assert explanation.source == "claude"
    assert explanation.model == "claude-opus-5-5"
    assert [s.title for s in explanation.steps] == ["Reference", "KCL at out", "Solve"]
    assert explanation.unverified_numbers == []

    [call] = fake.messages.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["output_config"]["format"] == {"type": "json_schema", "schema": OUTPUT_SCHEMA}
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert "temperature" not in call  # not accepted by current models
    assert "Explain that working; do not re-solve" in call["system"]
    context = json.loads(call["messages"][0]["content"])
    assert context["working"][1]["equation"] == "(v(out) − 12 V) / 2 kΩ + v(out) / 4 kΩ = 0"
    assert context["solution"]["node_voltages"]["out"] == "8 V"


def test_hallucinated_numbers_are_flagged() -> None:
    output = {**GOOD_OUTPUT, "summary": "The output sits at 7.9 V."}
    explainer = Explainer(ClaudeWriter(FakeClaude(claude_message(output)), "claude-opus-5-5"))
    netlist, analysis = divider()
    assert explainer.explain(netlist, analysis).unverified_numbers == ["7.9 V"]


def test_failures_fall_back_to_the_template_with_a_note() -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    failures = {
        "Claude API error: APIConnectionError": anthropic.APIConnectionError(request=request),
        "Claude declined to answer": claude_message(GOOD_OUTPUT, stop_reason="refusal"),
        "Claude's answer was cut off": claude_message(GOOD_OUTPUT, stop_reason="max_tokens"),
        "Claude's answer did not match the schema": claude_message('{"summary": 3}'),
    }
    netlist, analysis = divider()
    for reason, response in failures.items():
        explainer = Explainer(ClaudeWriter(FakeClaude(response), "claude-opus-5-5"))
        explanation = explainer.explain(netlist, analysis)
        assert explanation.source == "template"
        assert explanation.note is not None and explanation.note.startswith(reason), explanation.note


def test_feedback_sends_the_deterministic_diagnosis_and_allows_quoting_the_student() -> None:
    output = {
        "summary": "One answer needs another look.",
        "steps": [
            {
                "title": "v(out)",
                "detail": "You wrote 7 V, but KCL at out gives 8 V.",
                "equation": None,
            }
        ],
    }
    fake = FakeClaude(claude_message(output))
    explainer = Explainer(ClaudeWriter(fake, "claude-opus-5-5"))
    netlist, analysis = divider()
    results = check_answers(analysis, {"out": 7.0}, {})

    feedback = explainer.feedback(netlist, analysis, results)

    assert feedback.source == "claude"
    assert feedback.unverified_numbers == []  # 7 V is the student's own number
    context = json.loads(fake.messages.calls[0]["messages"][0]["content"])
    [row] = context["comparison"]
    assert row["quantity"] == "v(out)" and row["correct"] is False
    assert "KCL at node out does not balance" in row["likely_mistake"]
