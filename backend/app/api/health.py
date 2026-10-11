"""Health endpoint used by the sidebar connection indicator."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.db import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    """Report API and database availability.

    The frontend polls this so the sidebar never claims "connected" without a
    real response.
    """
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception:
        return {"status": "healthy", "database": "unavailable"}