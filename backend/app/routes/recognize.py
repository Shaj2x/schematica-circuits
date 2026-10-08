"""Photo -> editable schematic."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from schematica_vision import ImageError

from ..recognition import Recognizer
from ..schemas import RecognitionOut

router = APIRouter(prefix="/api", tags=["recognition"])

ACCEPTED = {"image/png", "image/jpeg", "image/webp"}


@router.post("/recognize", response_model=RecognitionOut)
def recognize_photo(request: Request, image: Annotated[UploadFile, File()]) -> dict[str, Any]:
    """Recognizes a photo of a circuit and returns an editor schematic plus
    the detections and warnings the UI shows for review.

    A plain `def`, so FastAPI runs it in its thread pool: the pipeline is CPU
    bound (about 0.1-0.5 s) and must not block the event loop.
    """
    recognizer: Recognizer = request.app.state.recognizer
    if not recognizer.available:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Photo recognition is not available: no trained model is installed (see ml/README.md).",
        )
    if image.content_type not in ACCEPTED:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a PNG, JPEG or WebP image.")
    limit = request.app.state.settings.max_upload_bytes
    data = image.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f"Images must be under {limit // (1024 * 1024)} MB."
        )
    try:
        return recognizer.run(data)
    except ImageError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error
