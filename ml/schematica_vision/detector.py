"""Symbol detection with the trained YOLOv8 model, exported to ONNX.

Training uses Ultralytics (PyTorch); serving does not. `train.py` exports the
model to ONNX, and this module runs it with onnxruntime and does the two
steps Ultralytics would otherwise do for us: letterboxing on the way in, and
decoding plus non-maximum suppression on the way out. That keeps PyTorch (a
gigabyte) and Ultralytics' AGPL licence out of the backend entirely.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from .classes import CLASSES
from .image import Image
from .types import Box, Detection


class Detector(Protocol):
    def detect(self, image: Image) -> list[Detection]: ...


def letterbox(image: Image, size: int) -> tuple[NDArray[np.float32], float, tuple[float, float]]:
    """Scales the image to fit a size x size square and pads the rest grey,
    as Ultralytics does in training. Returns the NCHW tensor, the scale, and
    the (x, y) padding, which `decode` needs to map boxes back."""
    height, width = image.shape[:2]
    scale = min(size / height, size / width)
    new_w, new_h = round(width * scale), round(height * scale)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    pad_x, pad_y = (size - new_w) / 2, (size - new_h) / 2
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    top, left = round(pad_y - 0.1), round(pad_x - 0.1)
    canvas[top : top + new_h, left : left + new_w] = resized
    rgb = canvas[:, :, ::-1].astype(np.float32) / 255.0
    return np.ascontiguousarray(rgb.transpose(2, 0, 1)[None]), scale, (left, top)


def nms(boxes: NDArray[np.float32], scores: NDArray[np.float32], iou_threshold: float) -> list[int]:
    """Greedy non-maximum suppression; returns kept indices, best first."""
    order = list(np.argsort(-scores))
    keep: list[int] = []
    while order:
        best = order.pop(0)
        keep.append(int(best))
        if not order:
            break
        rest = np.array(order)
        x0 = np.maximum(boxes[best, 0], boxes[rest, 0])
        y0 = np.maximum(boxes[best, 1], boxes[rest, 1])
        x1 = np.minimum(boxes[best, 2], boxes[rest, 2])
        y1 = np.minimum(boxes[best, 3], boxes[rest, 3])
        inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
        iou = inter / (_area(boxes[best]) + _area(boxes[rest]) - inter + 1e-9)
        order = [int(i) for i, o in zip(rest, iou, strict=True) if o <= iou_threshold]
    return keep


def _area(b: NDArray[np.float32]) -> NDArray[np.float32]:
    return (b[..., 2] - b[..., 0]) * (b[..., 3] - b[..., 1])


def decode(
    output: NDArray[np.float32],
    names: tuple[str, ...],
    scale: float,
    pad: tuple[float, float],
    image_size: tuple[int, int],
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.5,
) -> list[Detection]:
    """YOLOv8 raw output (1, 4 + classes, anchors) -> detections in image pixels.

    Each column is one candidate: box centre and size in letterboxed pixels,
    then one already-sigmoided score per class. NMS runs per class, so a
    junction dot inside a resistor's box does not suppress the resistor.
    """
    predictions = output[0].T  # (anchors, 4 + classes)
    scores_all = predictions[:, 4:]
    classes = scores_all.argmax(axis=1)
    scores = scores_all[np.arange(len(classes)), classes]
    keep = scores >= conf_threshold
    predictions, classes, scores = predictions[keep], classes[keep], scores[keep]

    cx, cy, w, h = predictions[:, 0], predictions[:, 1], predictions[:, 2], predictions[:, 3]
    boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
    boxes[:, [0, 2]] = (boxes[:, [0, 2]] - pad[0]) / scale
    boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pad[1]) / scale
    height, width = image_size
    boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, width)
    boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, height)

    detections = []
    for cls in np.unique(classes):
        index = np.flatnonzero(classes == cls)
        for i in nms(boxes[index], scores[index], iou_threshold):
            x0, y0, x1, y1 = (float(v) for v in boxes[index[i]])
            detections.append(Detection(names[int(cls)], float(scores[index[i]]), Box(x0, y0, x1, y1)))
    return sorted(detections, key=lambda d: -d.confidence)


class OnnxDetector:
    """Loads `model.onnx` once and runs it per request (thread-safe in onnxruntime)."""

    def __init__(self, path: Path, conf_threshold: float = 0.25) -> None:
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        model_input = self.session.get_inputs()[0]
        self.input_name: str = model_input.name
        self.size = int(model_input.shape[2]) if isinstance(model_input.shape[2], int) else 1024
        self.names = _class_names(self.session)
        self.conf_threshold = conf_threshold

    def detect(self, image: Image) -> list[Detection]:
        tensor, scale, pad = letterbox(image, self.size)
        (output,) = self.session.run(None, {self.input_name: tensor})
        return decode(output, self.names, scale, pad, image.shape[:2], self.conf_threshold)


def _class_names(session: object) -> tuple[str, ...]:
    """Ultralytics stores {index: name} in the ONNX metadata. Check that it
    matches our taxonomy, so a model trained with a different class order
    fails loudly at startup instead of mislabelling every part."""
    metadata = session.get_modelmeta().custom_metadata_map  # type: ignore[attr-defined]
    if "names" not in metadata:
        return CLASSES
    names = ast.literal_eval(metadata["names"])
    ordered = tuple(names[i] for i in range(len(names)))
    if ordered != CLASSES:
        raise ValueError(f"model classes {ordered} do not match schematica_vision.classes.CLASSES")
    return ordered
