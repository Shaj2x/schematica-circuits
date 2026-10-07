import numpy as np

from schematica_vision.classes import CLASSES
from schematica_vision.detector import decode, letterbox, nms


def test_letterbox_keeps_aspect_ratio_and_centres() -> None:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    tensor, scale, (left, top) = letterbox(image, 640)
    assert tensor.shape == (1, 3, 640, 640)
    assert scale == 3.2
    assert (left, top) == (0, 160)
    assert tensor.dtype == np.float32 and tensor.max() <= 1.0


def test_nms_keeps_the_best_of_overlapping_boxes() -> None:
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=np.float32)
    scores = np.array([0.6, 0.9, 0.5], dtype=np.float32)
    assert nms(boxes, scores, 0.5) == [1, 2]


def _output(rows: list[tuple[float, float, float, float, int, float]]) -> np.ndarray:
    """Builds a YOLOv8 output tensor (1, 4 + classes, anchors) from candidates."""
    out = np.zeros((1, 4 + len(CLASSES), len(rows)), dtype=np.float32)
    for i, (cx, cy, w, h, cls, score) in enumerate(rows):
        out[0, :4, i] = (cx, cy, w, h)
        out[0, 4 + cls, i] = score
    return out


def test_decode_maps_boxes_back_to_image_pixels() -> None:
    # Image 200 x 100 letterboxed into 640: scale 3.2, padded 160 px top.
    output = _output([(320, 320, 64, 32, 0, 0.9)])
    (detection,) = decode(output, CLASSES, 3.2, (0, 160), (100, 200))
    assert detection.label == "resistor"
    assert detection.confidence == np.float32(0.9)
    box = detection.box
    assert (box.x0, box.y0, box.x1, box.y1) == (90.0, 45.0, 110.0, 55.0)


def test_decode_filters_low_scores_and_suppresses_per_class() -> None:
    output = _output(
        [
            (100, 100, 40, 40, 0, 0.9),  # resistor
            (102, 101, 40, 40, 0, 0.8),  # duplicate resistor: suppressed
            (100, 100, 10, 10, 6, 0.7),  # junction inside it: different class, kept
            (300, 300, 40, 40, 1, 0.1),  # below threshold
        ]
    )
    detections = decode(output, CLASSES, 1.0, (0, 0), (640, 640))
    assert [d.label for d in detections] == ["resistor", "junction"]
