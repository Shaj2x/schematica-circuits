"""Plain data passed between pipeline stages. Coordinates are image pixels."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def iou(self, other: Box) -> float:
        ix = max(0.0, min(self.x1, other.x1) - max(self.x0, other.x0))
        iy = max(0.0, min(self.y1, other.y1) - max(self.y0, other.y0))
        inter = ix * iy
        union = self.area() + other.area() - inter
        return inter / union if union > 0 else 0.0

    def distance_to(self, other: Box) -> float:
        """Gap between the two boxes (0 if they overlap)."""
        dx = max(0.0, max(self.x0, other.x0) - min(self.x1, other.x1))
        dy = max(0.0, max(self.y0, other.y0) - min(self.y1, other.y1))
        return float((dx * dx + dy * dy) ** 0.5)

    def as_list(self) -> list[float]:
        return [round(self.x0, 1), round(self.y0, 1), round(self.x1, 1), round(self.y1, 1)]


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    box: Box


@dataclass(frozen=True)
class TextRead:
    text: str
    confidence: float
