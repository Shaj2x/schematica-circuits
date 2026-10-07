"""Loading a photo and separating ink from paper."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

# 8-bit BGR or single-channel images. Typed loosely because OpenCV's stubs
# return arrays of unspecified dtype.
Image = NDArray[Any]

# Phone photos are 12+ megapixels; wire tracing does not need that, and the
# detector resizes to its own input size anyway. Capping the long side keeps
# a request well under a second on a CPU.
MAX_SIDE = 1600


class ImageError(ValueError):
    """The upload is not an image OpenCV can read."""


def decode(data: bytes) -> Image:
    """Bytes of a PNG/JPEG/WebP -> BGR image, downscaled to MAX_SIDE."""
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR) if array.size else None
    if image is None:
        raise ImageError("could not read the upload as an image (use PNG, JPEG or WebP)")
    height, width = image.shape[:2]
    scale = MAX_SIDE / max(height, width)
    if scale < 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    return image


def ink_mask(image: Image) -> Image:
    """255 where there is pen, 0 where there is paper.

    Adaptive thresholding compares each pixel with its neighbourhood instead
    of one global level, so a shadow across half the page does not turn the
    paper there into ink. The block size scales with the image so pen strokes
    are thin relative to it at any resolution.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    block = max(15, (min(gray.shape[:2]) // 25) | 1)
    mask = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 15)
    # Speckles from paper texture and JPEG noise: drop tiny blobs.
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
