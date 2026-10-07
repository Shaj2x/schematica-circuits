"""Reading component values and labels from OCR text.

Schematics write values tersely: "10k", "4k7" (the RKM code, where the
prefix letter is the decimal point), "100n", "4.7uF", "12 V". The unit is
often missing, so a bare "10k" is a valid value and the component it sits
next to decides what it means. When a unit is written it is kept, because it
says which kind of part the text belongs to.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_SCALE = {
    "p": 1e-12,
    "n": 1e-9,
    "u": 1e-6,
    "m": 1e-3,
    "": 1.0,
    "R": 1.0,  # RKM: "2R2" is 2.2 Ω
    "k": 1e3,
    "K": 1e3,
    "M": 1e6,
    "G": 1e9,
}

UNIT_KIND = {
    "Ω": "resistor",
    "F": "capacitor",
    "H": "inductor",
    "V": "voltage_source",
    "A": "current_source",
}

_UNIT = r"(Ω|F|H|V|A)?"
_PLAIN = re.compile(rf"^(\d+(?:\.\d+)?)\s*([pnumkKMG]?)\s*{_UNIT}$")
_RKM = re.compile(rf"^(\d+)([pnumkKMGR])(\d+)\s*{_UNIT}$")
_LABEL = re.compile(r"^([RCLVI])\s*(\d{1,3})$")
_LABEL_PREFIX = re.compile(r"^([RCLVI]\d{1,3})\s*[=:]?\s*(.+)$")


@dataclass(frozen=True)
class Value:
    value: float
    kind: str | None  # the part kind its unit implies, if a unit was written


def _scaled(number: str, prefix: str) -> float:
    # Round away float noise: 100 * 1e-9 is 1.0000000000000001e-07.
    return float(f"{float(number) * _SCALE[prefix]:.12g}")


@dataclass(frozen=True)
class Reading:
    """What a piece of text says: a part label ("R1"), a value, or both."""

    label: str | None
    value: Value | None


def _normalize(text: str) -> str:
    text = text.strip().replace(",", ".").replace("µ", "u").replace("μ", "u")
    text = re.sub(r"\s*(ohms?|Ohms?|OHMS?)$", "Ω", text)
    # OCR commonly reads the omega as a capital O or "Q" after a prefix ("10kO").
    text = re.sub(r"(?<=[\dkKM])[OQ]$", "Ω", text)
    return text


def parse_value(text: str) -> Value | None:
    """'10k' -> 10000; '4k7' -> 4700; '100nF' -> 1e-7 (capacitor). None if not a value."""
    text = _normalize(text)
    if match := _PLAIN.match(text):
        number, prefix, unit = match.groups()
        # A lone "M" is mega for resistors but "m" is milli; both kept as written.
        return Value(_scaled(number, prefix), UNIT_KIND.get(unit) if unit else None)
    if match := _RKM.match(text):
        whole, prefix, fraction, unit = match.groups()
        return Value(_scaled(f"{whole}.{fraction}", prefix), UNIT_KIND.get(unit) if unit else None)
    return None


def read_text(text: str) -> Reading:
    """Splits "R1", "10k", "R1=10k" or "R1 10k" into a label and a value."""
    normalized = _normalize(text)
    if match := _LABEL.match(normalized):
        return Reading(label=f"{match.group(1)}{match.group(2)}", value=None)
    if (value := parse_value(normalized)) is not None:
        return Reading(label=None, value=value)
    if match := _LABEL_PREFIX.match(normalized):
        label, rest = match.groups()
        return Reading(label=label, value=parse_value(rest))
    return Reading(label=None, value=None)
