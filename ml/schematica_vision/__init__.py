"""Schematica's photo-to-schematic pipeline. See `pipeline.recognize`."""

from .detector import Detector, OnnxDetector
from .image import ImageError
from .ocr import RapidTextReader, TextReader
from .pipeline import recognize

__all__ = ["Detector", "ImageError", "OnnxDetector", "RapidTextReader", "TextReader", "recognize"]
