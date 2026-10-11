"""Application settings loaded from environment variables / .env."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, List

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# __file__ = <root>/backend/app/core/config.py
# parents[0] = .../backend/app/core, parents[1] = .../backend/app,
# parents[2] = .../backend, parents[3] = project root
BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "QuizForge"
    version: str = "1.0.0"

    host: str = "127.0.0.1"
    port: int = 8000

    database_url: str = f"sqlite:///{(PROJECT_ROOT / 'storage' / 'quizforge.db').as_posix()}"
    upload_dir: str = str(PROJECT_ROOT / "storage" / "uploads")

    max_file_size_mb: int = 25
    max_pages: int = 200

    # NoDecode stops pydantic-settings JSON-decoding the raw env string before
    # our validator runs (that decode is what crashed startup with SettingsError).
    cors_origins: Annotated[List[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Accept a comma-separated string for CORS_ORIGINS.

        Deploy platforms set plain strings such as:
            CORS_ORIGINS=https://app.netlify.app,https://api.onrender.com
        A JSON list is still accepted for backwards compatibility.
        """
        if isinstance(value, str):
            text = value.strip()
            if not text:
                # An empty variable must not silently disable CORS entirely.
                return ["http://localhost:5173", "http://127.0.0.1:5173"]
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, list):
                        return parsed
                except json.JSONDecodeError:
                    pass
            return [origin.strip().rstrip("/") for origin in text.split(",") if origin.strip()]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        """The origins to allow in CORS.

        Reads the already-validated ``cors_origins`` field rather than re-parsing
        the environment variable, so a comma-separated string and a JSON list are
        handled identically.
        """
        return [origin.strip().rstrip("/") for origin in self.cors_origins if origin.strip()]


settings = Settings()


def _ensure_upload_dir(directory: str) -> str:
    """Create the upload directory, falling back to a temp dir if it is unusable.

    This runs at import time, so an unhandled error here would stop the server
    from binding its port. On a host with a read-only app directory (or a disk
    that is not mounted) the configured path cannot be created, so we degrade to
    a temporary directory instead of failing to boot. Note that a fallback is
    NOT durable: files there are lost on restart.
    """
    try:
        Path(directory).mkdir(parents=True, exist_ok=True)
        return directory
    except OSError:
        import tempfile

        fallback = Path(tempfile.gettempdir()) / "quizforge" / "uploads"
        fallback.mkdir(parents=True, exist_ok=True)
        return str(fallback)


settings.upload_dir = _ensure_upload_dir(settings.upload_dir)
