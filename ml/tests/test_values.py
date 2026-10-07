import pytest

from schematica_vision.values import Reading, Value, parse_value, read_text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("10k", Value(10_000, None)),
        ("10 k", Value(10_000, None)),
        ("4k7", Value(4_700, None)),
        ("2R2", Value(2.2, None)),
        ("4u7", Value(4.7e-6, None)),
        ("1M", Value(1e6, None)),
        ("1m", Value(1e-3, None)),
        ("100nF", Value(1e-7, "capacitor")),
        ("4.7µF", Value(4.7e-6, "capacitor")),
        ("4,7uF", Value(4.7e-6, "capacitor")),
        ("10mH", Value(0.01, "inductor")),
        ("12 V", Value(12, "voltage_source")),
        ("2mA", Value(0.002, "current_source")),
        ("220Ω", Value(220, "resistor")),
        ("220 ohms", Value(220, "resistor")),
        ("10kO", Value(10_000, "resistor")),  # omega misread as O
        ("470", Value(470, None)),
    ],
)
def test_parses_values(text: str, expected: Value) -> None:
    assert parse_value(text) == expected


@pytest.mark.parametrize("text", ["", "hello", "k10", "10x", "--"])
def test_rejects_non_values(text: str) -> None:
    assert parse_value(text) is None


def test_separates_labels_and_values() -> None:
    assert read_text("R1") == Reading("R1", None)
    assert read_text("C 12") == Reading("C12", None)
    assert read_text("R1=10k") == Reading("R1", Value(10_000, None))
    assert read_text("V2 9V") == Reading("V2", Value(9, "voltage_source"))
    assert read_text("10k") == Reading(None, Value(10_000, None))
    assert read_text("~~") == Reading(None, None)
