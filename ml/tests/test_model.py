"""Checks for a trained model, skipped when there is none.

Point MODEL at an ONNX file (default: weights/model.onnx). The parity test
also needs Ultralytics (`uv sync --group train`).
"""

import os
import random
from pathlib import Path

import numpy as np
import pytest

from schematica_vision import OnnxDetector
from schematica_vision.synthetic import random_ladder, render

MODEL = Path(os.environ.get("MODEL", Path(__file__).parents[1] / "weights" / "model.onnx"))
pytestmark = pytest.mark.skipif(not MODEL.exists(), reason=f"no model at {MODEL}")


def test_decoder_matches_ultralytics() -> None:
    """Our letterbox + decode + NMS must give the boxes Ultralytics' own
    ONNX predictor gives, or the served model is not the evaluated one."""
    ultralytics = pytest.importorskip("ultralytics")
    image = render(random_ladder(random.Random(7)), unit=60, seed=7).image

    ours = OnnxDetector(MODEL, conf_threshold=0.25).detect(image)
    model = ultralytics.YOLO(str(MODEL), task="detect")
    (theirs,) = model.predict(image, imgsz=OnnxDetector(MODEL).size, conf=0.25, iou=0.5, verbose=False)
    if len(theirs.boxes) == 0 and not ours:
        pytest.skip("the model detects nothing on this image, so there is nothing to compare")

    names = theirs.names
    expected = sorted(
        (names[int(c)], tuple(np.round(b, 0)))
        for c, b in zip(theirs.boxes.cls.tolist(), theirs.boxes.xyxy.numpy(), strict=True)
    )
    got = sorted((d.label, tuple(np.round([d.box.x0, d.box.y0, d.box.x1, d.box.y1], 0))) for d in ours)
    assert len(got) == len(expected)
    for (label, box), (want_label, want_box) in zip(got, expected, strict=True):
        assert label == want_label
        assert np.abs(np.array(box) - np.array(want_box)).max() <= 2  # pixels
