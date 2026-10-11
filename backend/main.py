"""QuizForge FastAPI application entrypoint."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import attempts, documents, health, quizzes, settings as settings_api
from app.core.config import settings
from app.db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("quizforge")

app = FastAPI(
    title="QuizForge API",
    description="Local-first PDF quiz maker: upload, extract, generate, take and review quizzes.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    # Use cors_origin_list so a deployed CORS_ORIGINS value is actually honoured.
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"https://.*\.netlify\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(quizzes.router, prefix="/api")
app.include_router(attempts.quiz_router, prefix="/api")
app.include_router(attempts.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info("Database ready")


@app.get("/", tags=["health"])
def root() -> dict:
    return {"service": "QuizForge API", "version": "1.0.0", "docs": "/docs"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a safe message while keeping details in the server log."""
    logger.exception("Unhandled error for %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Something went wrong on the server. Check the backend logs for details."},
    )