"""Application settings loaded from environment variables / .env."""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

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

    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @property
    def cors_origin_list(self) -> list[str]:
        """Accept a comma-separated CORS_ORIGINS environment variable."""
        raw = os.getenv("CORS_ORIGINS")
        if not raw:
            return self.cors_origins
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


settings = Settings()

Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
Path(settings.upload_dir).parent.mkdir(parents=True, exist_ok=True)