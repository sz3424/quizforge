"""Quiz creation, review editing and export."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Attempt, AttemptAnswer, Document, DocumentPage, Question, Quiz
from app.requests import QuestionUpsert, QuestionsReplaceRequest, QuizGenerateRequest, QuizUpdateRequest
from app.schemas import serialize_quiz
from app.services.export import build_quiz_export
from app.services.question_generation import GenerationError, generate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quizzes", tags=["quizzes"])


@router.post("/generate", status_code=status.HTTP_201_CREATED)
def generate_quiz(payload: QuizGenerateRequest, db: Session = Depends(get_db)) -> dict:
    document = db.get(Document, payload.document_id)
    if not document:
        raise HTTPException(status_code=404, detail="This document could not be found. It may have been deleted.")

    if document.extraction_status != "extracted":
        raise HTTPException(
            status_code=400,
            detail="This PDF has no selectable text, so questions cannot be generated from it. OCR is not supported.",
        )

    config = payload.config
    question_count = int(config.get("question_count", 10))
    question_types = list(config.get("question_types") or ["multiple_choice"])
    topic_pages = config.get("topic_pages")

    pages = db.scalars(
        select(DocumentPage).where(DocumentPage.document_id == document.id).order_by(DocumentPage.page_number)
    ).all()
    page_pairs = [(page.page_number, page.text or "") for page in pages]

    try:
        result = generate(
            pages=page_pairs,
            count=question_count,
            types=question_types,
            difficulty=payload.difficulty,
            topic_pages=topic_pages,
        )
    except GenerationError as exc:
        logger.warning("Generation refused for document %s: %s", document.id, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    stored_config = dict(config)
    stored_config["provider_label"] = result.provider_label

    quiz = Quiz(
        title=payload.title,
        document_id=document.id,
        difficulty=payload.difficulty,
        config=stored_config,
        generation_method=result.method,
    )
    db.add(quiz)
    db.flush()

    for index, question in enumerate(result.questions):
        db.add(
            Question(
                quiz_id=quiz.id,
                text=question.text,
                type=question.type,
                difficulty=question.difficulty or payload.difficulty,
                options=question.options if question.type == "multiple_choice" else None,
                correct_answer=question.correct_answer,
                explanation=question.explanation,
                source_page=question.source_pages[0] if question.source_pages else None,
                source_excerpt=question.source_excerpt,
                order=index,
            )
        )

    db.commit()
    db.refresh(quiz)

    return serialize_quiz(quiz, include_questions=True)


@router.get("")
def list_quizzes(db: Session = Depends(get_db)) -> list[dict]:
    quizzes = db.scalars(select(Quiz).order_by(Quiz.created_at.desc())).all()
    return [serialize_quiz(quiz) for quiz in quizzes]


@router.get("/{quiz_id}")
def get_quiz(quiz_id: int, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")
    return serialize_quiz(quiz, include_questions=True)


@router.patch("/{quiz_id}")
def update_quiz(quiz_id: int, payload: QuizUpdateRequest, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")

    if payload.title is not None:
        cleaned = payload.title.strip()
        if not cleaned:
            raise HTTPException(status_code=422, detail="Title cannot be blank.")
        quiz.title = cleaned
    if payload.difficulty is not None:
        quiz.difficulty = payload.difficulty
    if payload.config is not None:
        quiz.config = {**(quiz.config or {}), **payload.config}

    quiz.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(quiz)
    return serialize_quiz(quiz, include_questions=True)


@router.put("/{quiz_id}/questions")
def replace_questions(quiz_id: int, payload: QuestionsReplaceRequest, db: Session = Depends(get_db)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")

    attempts = db.scalars(select(Attempt).where(Attempt.quiz_id == quiz.id)).all()
    if any(attempt.status == "completed" for attempt in attempts):
        raise HTTPException(
            status_code=409,
            detail="This quiz already has completed attempts. Editing questions would change saved history.",
        )

    existing = {question.id: question for question in quiz.questions}

    for index, item in enumerate(payload.questions):
        _validate_question_payload(item)
        source_page = item.source_pages[0] if item.source_pages else None

        if item.id and item.id in existing:
            question = existing[item.id]
            question.text = item.text.strip()
            question.type = item.type
            question.difficulty = item.difficulty
            question.options = item.options if item.type == "multiple_choice" else None
            question.correct_answer = item.correct_answer
            question.explanation = item.explanation
            question.source_page = source_page
            question.order = index
        else:
            db.add(
                Question(
                    quiz_id=quiz.id,
                    text=item.text.strip(),
                    type=item.type,
                    difficulty=item.difficulty,
                    options=item.options if item.type == "multiple_choice" else None,
                    correct_answer=item.correct_answer,
                    explanation=item.explanation,
                    source_page=source_page,
                    order=index,
                )
            )

    keep_ids = {item.id for item in payload.questions if item.id}
    for question_id, question in existing.items():
        if question_id not in keep_ids:
            db.execute(delete(AttemptAnswer).where(AttemptAnswer.question_id == question_id))
            db.delete(question)

    quiz.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(quiz)
    return serialize_quiz(quiz, include_questions=True)


def _validate_question_payload(item: QuestionUpsert) -> None:
    if not item.text.strip():
        raise HTTPException(status_code=422, detail="Question text is required.")

    if item.type == "multiple_choice":
        options = [option for option in (item.options or []) if option and option.strip()]
        if len(options) < 2:
            raise HTTPException(status_code=422, detail="Multiple-choice questions need at least two options.")
        if item.correct_answer not in options:
            raise HTTPException(status_code=422, detail="Mark one of the provided options as correct.")

    if item.type == "true_false" and item.correct_answer not in ("true", "false"):
        raise HTTPException(status_code=422, detail="True/false questions need a correct answer of true or false.")

    if item.type == "short_answer" and not (item.correct_answer or "").strip():
        raise HTTPException(status_code=422, detail="Short-answer questions need an expected answer.")


@router.delete("/{quiz_id}")
def delete_quiz(quiz_id: int, db: Session = Depends(get_db)) -> JSONResponse:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")

    question_ids = [question.id for question in quiz.questions]
    attempt_ids = [attempt.id for attempt in quiz.attempts]

    if question_ids:
        db.execute(delete(AttemptAnswer).where(AttemptAnswer.question_id.in_(question_ids)))
    if attempt_ids:
        db.execute(delete(AttemptAnswer).where(AttemptAnswer.attempt_id.in_(attempt_ids)))

    db.execute(delete(Attempt).where(Attempt.quiz_id == quiz.id))
    db.execute(delete(Question).where(Question.quiz_id == quiz.id))
    db.delete(quiz)
    db.commit()

    return JSONResponse({"message": "Quiz and its recorded attempts were deleted."})


@router.get("/{quiz_id}/export")
def export_quiz(
    quiz_id: int,
    include_answers: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="This quiz could not be found. It may have been deleted.")

    payload = build_quiz_export(quiz, include_answers=include_answers)
    suffix = "with-answers" if include_answers else "questions-only"
    filename = f"quizforge-quiz-{quiz.id}-{suffix}.json"

    import json

    return StreamingResponse(
        iter([json.dumps(payload, indent=2, default=str)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )