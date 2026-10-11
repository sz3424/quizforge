"""Quiz attempts: starting, saving answers, submitting and reading results."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Attempt, AttemptAnswer, Question, Quiz
from app.requests import SaveAnswersRequest
from app.schemas import serialize_attempt, serialize_attempt_results, serialize_question
from app.services.export import build_attempt_csv, build_attempt_export
from app.services.grading import grade_attempt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/attempts", tags=["attempts"])


def _require_attempt(attempt_id: int, db: Session) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="This attempt could not be found. It may have been deleted.")
    return attempt


@router.get("")
def list_attempts(db: Session = Depends(get_db)) -> list[dict]:
    attempts = db.scalars(select(Attempt).order_by(Attempt.started_at.desc())).all()
    serialized = []
    for attempt in attempts:
        questions = {question.id: question for question in attempt.quiz.questions}
        serialized.append(serialize_attempt(attempt, include_answers=True, questions_by_id=questions))
    return serialized


@router.get("/{attempt_id}")
def get_attempt(attempt_id: int, db: Session = Depends(get_db)) -> dict:
    attempt = _require_attempt(attempt_id, db)
    questions = {question.id: question for question in attempt.quiz.questions}
    return serialize_attempt(attempt, include_answers=True, questions_by_id=questions)


@router.get("/{attempt_id}/results")
def get_attempt_results(attempt_id: int, db: Session = Depends(get_db)) -> dict:
    attempt = _require_attempt(attempt_id, db)
    if attempt.status != "completed":
        raise HTTPException(status_code=409, detail="This attempt has not been submitted yet.")
    return serialize_attempt_results(attempt)


@router.get("/{attempt_id}/export")
def export_attempt(
    attempt_id: int,
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    import json

    attempt = _require_attempt(attempt_id, db)
    if attempt.status != "completed":
        raise HTTPException(status_code=409, detail="This attempt has not been submitted yet.")

    if format == "csv":
        body = build_attempt_csv(attempt)
        media_type = "text/csv"
        extension = "csv"
    else:
        body = json.dumps(build_attempt_export(attempt), indent=2, default=str)
        media_type = "application/json"
        extension = "json"

    filename = f"quizforge-results-{attempt.id}.{extension}"
    return StreamingResponse(
        iter([body]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- #
# Quiz-scoped attempt routes live here so /api/quizzes/{id}/attempts keeps working
# --------------------------------------------------------------------------- #

quiz_router = APIRouter(prefix="/quizzes", tags=["attempts"])


@quiz_router.post("/{quiz_id}/attempts", status_code=status.HTTP_201_CREATED)
def start_attempt(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")

    if not quiz.questions:
        raise HTTPException(status_code=409, detail="This quiz has no questions yet.")

    attempt = Attempt(quiz_id=quiz.id, status="in_progress", started_at=datetime.now(timezone.utc))
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return serialize_attempt(attempt)


@quiz_router.put("/{quiz_id}/attempts/{attempt_id}/answers")
def save_answers(
    quiz_id: int,
    attempt_id: int,
    payload: SaveAnswersRequest,
    db: Session = Depends(get_db),
) -> dict:
    attempt = _require_attempt(attempt_id, db)
    if attempt.quiz_id != quiz_id:
        raise HTTPException(status_code=404, detail="This attempt does not belong to that quiz.")
    if attempt.status != "in_progress":
        raise HTTPException(status_code=409, detail="This attempt was already submitted and cannot be edited.")

    valid_ids = {question.id for question in attempt.quiz.questions}
    existing = {answer.question_id: answer for answer in attempt.answers}

    for entry in payload.answers:
        try:
            question_id = int(entry.get("question_id"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Each answer needs a numeric question_id.")

        if question_id not in valid_ids:
            raise HTTPException(status_code=422, detail=f"Question {question_id} is not part of this quiz.")

        submitted = str(entry.get("answer") or "").strip()

        answer = existing.get(question_id)
        if answer is None:
            answer = AttemptAnswer(attempt_id=attempt.id, question_id=question_id)
            db.add(answer)
        answer.submitted_answer = submitted or None
        answer.reviewed = bool(entry.get("reviewed", False))

    db.commit()
    return {"message": "Answers saved.", "saved": len(payload.answers)}


@quiz_router.post("/{quiz_id}/attempts/{attempt_id}/submit")
def submit_attempt(quiz_id: int, attempt_id: int, db: Session = Depends(get_db)) -> dict:
    attempt = _require_attempt(attempt_id, db)
    if attempt.quiz_id != quiz_id:
        raise HTTPException(status_code=404, detail="This attempt does not belong to that quiz.")
    if attempt.status == "completed":
        raise HTTPException(status_code=409, detail="This attempt was already submitted.")

    result = grade_attempt(attempt, db)

    submitted_at = datetime.now(timezone.utc)
    attempt.submitted_at = submitted_at
    attempt.status = "completed"
    attempt.score = result.awarded
    attempt.max_score = result.maximum
    attempt.percentage = round((result.awarded / result.maximum) * 100, 2) if result.maximum else 0.0

    started = attempt.started_at
    if started is not None:
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        attempt.duration_seconds = max(0, int((submitted_at - started).total_seconds()))

    db.commit()
    db.refresh(attempt)

    return serialize_attempt(
        attempt,
        include_answers=True,
        questions_by_id={question.id: question for question in attempt.quiz.questions},
    )


@quiz_router.get("/{quiz_id}/attempts")
def list_quiz_attempts(quiz_id: int, db: Session = Depends(get_db)) -> list[dict]:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")
    attempts = db.scalars(select(Attempt).where(Attempt.quiz_id == quiz_id).order_by(Attempt.started_at.desc())).all()
    questions = {question.id: question for question in quiz.questions}
    return [serialize_attempt(attempt, include_answers=True, questions_by_id=questions) for attempt in attempts]