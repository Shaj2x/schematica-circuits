"""Settings, read from environment variables (and an optional `.env` file)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://schematica:schematica@localhost:5432/schematica"

    # Never hardcoded: read from the environment. When unset, explanations are
    # generated from the deterministic template instead of by Claude.
    anthropic_api_key: SecretStr | None = Field(default=None)
    anthropic_model: str = "claude-opus-5-5"

    # Origins allowed to call the API directly. In development the Vite dev
    # server proxies /api, so the browser never makes a cross-origin call.
    cors_origins: list[str] = ["http://localhost:5173"]

    # Upper bound on circuit size per request, so one request cannot tie up a
    # worker with a pathological netlist.
    max_components: int = 500

    # The trained symbol detector (ml/training/train.py). When the file is
    # missing, photo recognition is off and its endpoint answers 503.
    model_path: Path = Path(__file__).resolve().parents[2] / "ml" / "weights" / "model.onnx"
    # Uploads above this are rejected before decoding. Phone photos are 2-8 MB.
    max_upload_bytes: int = 15 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
