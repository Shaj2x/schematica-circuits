"""Reading the text the detector found (values like "10k", labels like "R1")."""

from __future__ import annotations

from typing import Any, Protocol

import cv2

from .image import Image
from .types import TextRead


class TextReader(Protocol):
    def read(self, crop: Image) -> TextRead | None: ...


class RapidTextReader:
    """PaddleOCR's text recogniser, run through onnxruntime by RapidOCR.

    Only the recognition model runs: the detector has already found the text
    boxes, so OCR's own text detection would be wasted work. Handwritten
    values are often written sideways next to vertical parts, so a tall crop
    is also read rotated a quarter turn each way, keeping the most confident
    reading.
    """

    def __init__(self) -> None:
        from rapidocr_onnxruntime import RapidOCR

        self.engine: Any = RapidOCR()

    def _recognize(self, crop: Image) -> TextRead | None:
        result, _ = self.engine(crop, use_det=False, use_cls=False, use_rec=True)
        if not result:
            return None
        text, score = result[0][0], float(result[0][1])
        return TextRead(text.strip(), score) if text.strip() else None

    def read(self, crop: Image) -> TextRead | None:
        height, width = crop.shape[:2]
        candidates = [crop]
        if height > 1.5 * width:
            candidates += [
                cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE),
                cv2.rotate(crop, cv2.ROTATE_90_COUNTERCLOCKWISE),
            ]
        reads = [r for c in candidates if (r := self._recognize(c)) is not None]
        return max(reads, key=lambda r: r.confidence, default=None)
