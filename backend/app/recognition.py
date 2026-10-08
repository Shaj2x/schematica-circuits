"""Photo recognition: loading the model once, and running the pipeline.

The model is optional. A fresh clone without trained weights, or a deploy
that does not want the feature, still runs the rest of the API; the endpoint
then says plainly that no model is installed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from schematica_vision import Detector, OnnxDetector, TextReader, recognize

from .config import Settings

log = logging.getLogger(__name__)


@dataclass
class Recognizer:
    detector: Detector | None = None
    reader: TextReader | None = None

    @property
    def available(self) -> bool:
        return self.detector is not None

    def run(self, data: bytes) -> dict[str, Any]:
        assert self.detector is not None
        return recognize(data, self.detector, self.reader)


def make_recognizer(settings: Settings) -> Recognizer:
    if not settings.model_path.exists():
        log.info("no model at %s: photo recognition is off", settings.model_path)
        return Recognizer()
    detector = OnnxDetector(settings.model_path)
    try:
        from schematica_vision import RapidTextReader

        reader: TextReader | None = RapidTextReader()
    except ImportError:
        log.warning("rapidocr is not installed: values will not be read from photos")
        reader = None
    return Recognizer(detector, reader)
