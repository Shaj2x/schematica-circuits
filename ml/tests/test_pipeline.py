import cv2
import numpy as np
import pytest
from circuits import ALL, DIVIDER, LADDER
from netlists import assert_equivalent

from schematica_vision import ImageError, recognize
from schematica_vision.layout import netlist_of
from schematica_vision.synthetic import GroundTruthDetector, GroundTruthReader, render
from schematica_vision.types import Box, Detection


def codes(result: dict) -> set[str]:
    return {w["code"] for w in result["warnings"]}


@pytest.mark.parametrize("name", sorted(ALL))
@pytest.mark.parametrize("seed", [0, 1, 2])
def test_recovers_rendered_circuits(name: str, seed: int) -> None:
    rendering = render(ALL[name], seed=seed, jitter=1.5, wire_gap=5)
    result = recognize(rendering.image, GroundTruthDetector(rendering), GroundTruthReader(rendering))
    assert_equivalent(result["netlist"], netlist_of(ALL[name]))
    assert codes(result) <= {"polarity"}


def test_accepts_encoded_images_and_scales() -> None:
    rendering = render(DIVIDER, unit=90)
    _, png = cv2.imencode(".png", rendering.image)
    result = recognize(png.tobytes(), GroundTruthDetector(rendering), GroundTruthReader(rendering))
    assert_equivalent(result["netlist"], netlist_of(DIVIDER))
    assert result["image"] == {"width": rendering.image.shape[1], "height": rendering.image.shape[0]}


def test_rejects_non_images() -> None:
    with pytest.raises(ImageError):
        recognize(b"not an image", GroundTruthDetector(render(DIVIDER)))


def test_without_ocr_values_default_and_say_so() -> None:
    rendering = render(DIVIDER)
    result = recognize(rendering.image, GroundTruthDetector(rendering), reader=None)
    assert "ocr_unavailable" in codes(result)
    assert {c["value"] for c in result["netlist"]["components"] if c["type"] == "resistor"} == {1000.0}


def test_reports_parts_and_detections() -> None:
    rendering = render(LADDER)
    result = recognize(rendering.image, GroundTruthDetector(rendering), GroundTruthReader(rendering))
    parts = [d for d in result["detections"] if d["part_id"]]
    assert sorted(d["part_id"] for d in parts) == ["C1", "I1", "L1", "R1"]
    capacitor = next(d for d in parts if d["label"] == "capacitor")
    assert capacitor["value_text"] == "100nF"
    assert {"I1"} == set(next(w for w in result["warnings"] if w["code"] == "polarity")["part_ids"])


def test_missing_ground_is_reported() -> None:
    rendering = render(DIVIDER)
    result = recognize(
        rendering.image, GroundTruthDetector(rendering, drop={"ground"}), GroundTruthReader(rendering)
    )
    assert "no_ground" in codes(result)


def test_unsupported_symbols_are_reported() -> None:
    rendering = render(DIVIDER)
    detector = GroundTruthDetector(rendering)
    detector.detections.append(Detection("other", 0.9, Box(5, 5, 30, 30)))
    result = recognize(rendering.image, detector, GroundTruthReader(rendering))
    assert "unsupported_symbol" in codes(result)


def test_low_confidence_parts_are_named() -> None:
    rendering = render(DIVIDER)
    detector = GroundTruthDetector(rendering)
    detector.detections = [
        Detection(d.label, 0.3, d.box) if d.label == "voltage_source" else d for d in detector.detections
    ]
    result = recognize(rendering.image, detector, GroundTruthReader(rendering))
    low = next(w for w in result["warnings"] if w["code"] == "low_confidence")
    assert low["part_ids"] == ["V1"]


def test_written_labels_become_ids() -> None:
    rendering = render(DIVIDER, labels=False)
    detector = GroundTruthDetector(rendering)
    # Label the right-hand resistor "R7", just to its right.
    resistor = max((d for d in detector.detections if d.label == "resistor"), key=lambda d: d.box.x0)
    label_box = Box(resistor.box.x1 + 5, resistor.box.y0, resistor.box.x1 + 40, resistor.box.y0 + 20)
    detector.detections.append(Detection("text", 0.9, label_box))

    class Reader:
        def read(self, crop: np.ndarray):
            from schematica_vision.types import TextRead

            return TextRead("R7", 0.9)

    result = recognize(rendering.image, detector, Reader())
    ids = sorted(c["id"] for c in result["netlist"]["components"])
    assert ids == ["R1", "R7", "V1"]


def test_empty_photo() -> None:
    image = np.full((200, 300, 3), 245, dtype=np.uint8)
    result = recognize(
        image,
        GroundTruthDetector(
            render(DIVIDER), drop=set(ALL) | {"resistor", "voltage_source", "ground", "text", "junction"}
        ),
    )
    assert result["schematic"] == {"parts": [], "wires": [], "grounds": []}
    assert "nothing_found" in codes(result)


def test_real_ocr_reads_rendered_values() -> None:
    pytest.importorskip("rapidocr_onnxruntime")
    from schematica_vision import RapidTextReader

    rendering = render(LADDER)
    result = recognize(rendering.image, GroundTruthDetector(rendering), RapidTextReader())
    assert_equivalent(result["netlist"], netlist_of(LADDER))
    assert "default_value" not in codes(result)


@pytest.mark.parametrize("seed", range(10))
def test_recovers_random_ladders(seed: int) -> None:
    import random

    from schematica_vision.synthetic import random_ladder

    schematic = random_ladder(random.Random(seed))
    rendering = render(schematic, seed=seed, jitter=1.5, wire_gap=4)
    result = recognize(rendering.image, GroundTruthDetector(rendering), GroundTruthReader(rendering))
    ids = {source: result["detections"][i]["part_id"] for i, source in rendering.sources.items()}
    assert_equivalent(result["netlist"], netlist_of(schematic), ids)
