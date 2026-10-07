"""The detector's classes, in model output order.

The taxonomy is ours, not the dataset's. CGHD has about 45 symbol classes;
training maps them onto the parts the solver supports, plus the marks the
pipeline needs to read a drawing (junction dots, crossovers, text), plus one
`other` class for every symbol we cannot simulate. Detecting unsupported
parts matters: without `other`, an op-amp would be invisible, its wires would
be traced straight through it, and the circuit would be silently wrong.
"""

from __future__ import annotations

from typing import Literal

ComponentKind = Literal["resistor", "capacitor", "inductor", "voltage_source", "current_source"]

CLASSES: tuple[str, ...] = (
    "resistor",
    "capacitor",
    "inductor",
    "voltage_source",
    "current_source",
    "ground",
    "junction",
    "crossover",
    "text",
    "other",
)

COMPONENT_KINDS: frozenset[str] = frozenset(
    {"resistor", "capacitor", "inductor", "voltage_source", "current_source"}
)

# Symbols that are wiring, not components: they are masked out before wire
# tracing but never become parts.
MARKS: frozenset[str] = frozenset({"junction", "crossover", "text"})

ID_PREFIX: dict[str, str] = {
    "resistor": "R",
    "capacitor": "C",
    "inductor": "L",
    "voltage_source": "V",
    "current_source": "I",
}

# What a part gets when no value can be read for it. Matches the editor's
# defaults, so a recognized part behaves like a freshly placed one.
DEFAULT_VALUE: dict[str, float] = {
    "resistor": 1000.0,
    "capacitor": 1e-6,
    "inductor": 1e-3,
    "voltage_source": 5.0,
    "current_source": 1e-3,
}
