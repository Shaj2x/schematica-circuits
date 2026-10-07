"""Formatting and reading quantities with SI prefixes ("4.7 kΩ", "3.33 mA")."""

from __future__ import annotations

import re
from dataclasses import dataclass

_FORMAT_PREFIXES = [
    (1e9, "G"),
    (1e6, "M"),
    (1e3, "k"),
    (1.0, ""),
    (1e-3, "m"),
    (1e-6, "µ"),
    (1e-9, "n"),
    (1e-12, "p"),
]


def format_value(value: float, unit: str, digits: int = 3) -> str:
    """4700, "Ω" -> "4.7 kΩ"; 0.003333, "A" -> "3.33 mA". Same rules as the frontend."""
    if abs(value) < 1e-15:
        return f"0 {unit}"
    magnitude = abs(value)
    scale, prefix = next(((s, p) for s, p in _FORMAT_PREFIXES if magnitude >= s * 0.9995), (1e-12, "p"))
    return f"{value / scale:.{digits}g} {prefix}{unit}"


_PREFIX_SCALE = {
    "G": 1e9,
    "M": 1e6,
    "k": 1e3,
    "m": 1e-3,
    "u": 1e-6,
    "µ": 1e-6,  # micro sign
    "μ": 1e-6,  # Greek mu, which models and keyboards also produce
    "n": 1e-9,
    "p": 1e-12,
}

# A number, an optional SI prefix, and a unit. Bare numbers are ignored on
# purpose: in prose they are usually step numbers or exponents, not values.
_QUANTITY = re.compile(
    r"(?<![\w.])([+\-−]?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)\s?([GMkmuµμnp])?(V|A|W|Ω|ohms?)(?![A-Za-z])"
)


@dataclass(frozen=True)
class Quantity:
    text: str
    value: float
    unit: str  # "V", "A", "W" or "Ω"


def find_quantities(text: str) -> list[Quantity]:
    """Every value-with-unit written in a piece of text."""
    found = []
    for match in _QUANTITY.finditer(text):
        number, prefix, unit = match.groups()
        value = float(number.replace("−", "-")) * (_PREFIX_SCALE[prefix] if prefix else 1.0)
        found.append(Quantity(match.group(0), value, "Ω" if unit.startswith("ohm") else unit))
    return found
