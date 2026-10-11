"""Settings and data-management endpoints."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import (
    ActivityLog,
    Attempt,
    AttemptAnswer,
    Document,
    DocumentPage,
    Question,
    Quiz,
)
from app.services.question_generation import provider_status

router = APIRouter(tags=["settings"])


@router.get("/settings/provider")
def get_provider_status() -> dict:
    """Report provider configuration without ever returning the API key."""
    return provider_status()


@router.get("/settings")
def get_settings() -> dict:
    return {
        "app_version": "1.0.0",
        "max_file_size_mb": settings.max_file_size_mb,
        "max_pages": settings.max_pages,
        "max_question_count": 50,
        "provider": provider_status(),
    }


@router.get("/data/export")
def export_all_data(db: Session = Depends(get_db)) -> StreamingResponse:
    documents = db.scalars(select(Document)).all()
    quizzes = db.scalars(select(Quiz)).all()
    attempts = db.scalars(select(Attempt)).all()

    payload = {
        "format": "quizforge.data.v1",
        "exported_documents": [
            {
                "id": document.id,
                "original_filename": document.original_filename,
                "page_count": document.page_count,
                "extraction_status": document.extraction_status,
                "created_at": document.created_at,
            }
            for document in documents
        ],
        "exported_quizzes": [
            {
                "id": quiz.id,
                "title": quiz.title,
                "document_id": quiz.document_id,
                "difficulty": quiz.difficulty,
                "generation_method": quiz.generation_method,
                "config": quiz.config or {},
                "question_count": len(quiz.questions),
            }
            for quiz in quizzes
        ],
        "exported_attempts": [
            {
                "id": attempt.id,
                "quiz_id": attempt.quiz_id,
                "status": attempt.status,
                "score": attempt.score,
                "max_score": attempt.max_score,
                "percentage": attempt.percentage,
                "started_at": attempt.started_at,
                "submitted_at": attempt.submitted_at,
            }
            for attempt in attempts
        ],
    }

    return StreamingResponse(
        iter([json.dumps(payload, indent=2, default=str)]),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="quizforge-data.json"'},
    )


@router.delete("/data")
def clear_all_data(db: Session = Depends(get_db)) -> JSONResponse:
    """Delete every document, quiz and attempt, plus the stored PDF files."""
    documents = db.scalars(select(Document)).all()
    storage_names = [document.internal_filename for document in documents]

    quiz_ids = [quiz.id for quiz in db.scalars(select(Quiz)).all()]
    question_ids = [question.id for question in db.scalars(select(Question)).all()]
    attempt_ids = [attempt.id for attempt in db.scalars(select(Attempt)).all()]

    if question_ids:
        db.execute(delete(AttemptAnswer).where(AttemptAnswer.question_id.in_(question_ids)))
    if attempt_ids:
        db.execute(delete(AttemptAnswer).where(AttemptAnswer.attempt_id.in_(attempt_ids)))
    if quiz_ids:
        db.execute(delete(Attempt).where(Attempt.quiz_id.in_(quiz_ids)))
    db.execute(delete(Question))
    db.execute(delete(Attempt))
    db.execute(delete(Quiz))
    db.execute(delete(DocumentPage))
    db.execute(delete(Document))
    db.execute(delete(ActivityLog))
    db.commit()

    upload_dir = Path(settings.upload_dir).resolve()
    for name in storage_names:
        candidate = (upload_dir / name).resolve()
        if candidate.parent == upload_dir:
            candidate.unlink(missing_ok=True)

    return JSONResponse({"message": "All documents, quizzes and attempts were deleted."})