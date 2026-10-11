"""Response serializers shared by the API routers.

The frontend consumes nested shapes (quiz -> questions/document/attempts), so we
build explicit dictionaries here instead of relying on lazy SQLAlchemy
relationships inside Pydantic models.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from app.models import Attempt, AttemptAnswer, Document, DocumentPage, Question, Quiz


def serialize_document(document: Document, pages: Iterable[DocumentPage] | None = None) -> dict[str, Any]:
    page_list = list(pages) if pages is not None else []
    total_characters = sum(len(page.text or "") for page in page_list)

    return {
        "id": document.id,
        "original_filename": document.original_filename,
        "internal_filename": document.internal_filename,
        "file_size": document.file_size,
        "page_count": document.page_count,
        "extraction_status": document.extraction_status,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
        "total_characters": total_characters or None,
        "total_words": (total_characters // 5) or None if total_characters else None,
    }


def serialize_document_page(page: DocumentPage) -> dict[str, Any]:
    return {
        "id": page.id,
        "document_id": page.document_id,
        "page_number": page.page_number,
        "text": page.text or "",
    }


def serialize_question(question: Question) -> dict[str, Any]:
    return {
        "id": question.id,
        "quiz_id": question.quiz_id,
        "text": question.text,
        "type": question.type,
        "difficulty": question.difficulty,
        "options": question.options,
        "correct_answer": question.correct_answer,
        "explanation": question.explanation,
        "source_pages": [question.source_page] if question.source_page else [],
        "source_excerpt": question.source_excerpt,
        "order": question.order,
    }


def serialize_attempt_answer(answer: AttemptAnswer, question: Question | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": answer.id,
        "attempt_id": answer.attempt_id,
        "question_id": answer.question_id,
        "submitted_answer": answer.submitted_answer,
        "correctness": answer.correctness,
        "awarded_marks": answer.awarded_marks,
        "reviewed": answer.reviewed,
    }
    if question is not None:
        payload["question_type"] = question.type
        payload["question_text"] = question.text
    return payload


def _duration_seconds(attempt: Attempt) -> int | None:
    if attempt.submitted_at and attempt.started_at:
        started = attempt.started_at
        if started.tzinfo is not None:
            started = started.replace(tzinfo=None)
        return max(0, int((attempt.submitted_at - started).total_seconds()))
    return None


def serialize_attempt(
    attempt: Attempt,
    include_answers: bool = False,
    questions_by_id: dict[int, Question] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": attempt.id,
        "quiz_id": attempt.quiz_id,
        "quiz_title": attempt.quiz.title if attempt.quiz else None,
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "status": attempt.status,
        "score": attempt.score,
        "max_score": attempt.max_score,
        "percentage": attempt.percentage,
        "duration_seconds": attempt.duration_seconds or _duration_seconds(attempt),
    }

    if include_answers:
        lookup = questions_by_id or {}
        payload["answers"] = [
            serialize_attempt_answer(answer, lookup.get(answer.question_id)) for answer in attempt.answers
        ]

    return payload


def serialize_quiz(
    quiz: Quiz,
    include_questions: bool = False,
    include_attempts: bool = True,
) -> dict[str, Any]:
    questions = sorted(quiz.questions, key=lambda question: question.order)

    payload: dict[str, Any] = {
        "id": quiz.id,
        "title": quiz.title,
        "document_id": quiz.document_id,
        "difficulty": quiz.difficulty,
        "config": quiz.config or {},
        "generation_method": quiz.generation_method,
        "created_at": quiz.created_at,
        "updated_at": quiz.updated_at,
        "question_count": len(questions),
        "document": serialize_document(quiz.document) if quiz.document else None,
    }

    if include_attempts:
        payload["attempts"] = [
            serialize_attempt(attempt) for attempt in sorted(quiz.attempts, key=lambda a: a.id)
        ]

    if include_questions:
        payload["questions"] = [serialize_question(question) for question in questions]

    return payload


def serialize_attempt_results(attempt: Attempt) -> dict[str, Any]:
    quiz = attempt.quiz
    questions = sorted(quiz.questions, key=lambda question: question.order)
    answers_by_question: dict[int, AttemptAnswer] = {
        answer.question_id: answer for answer in attempt.answers
    }

    answers = []
    correct_count = incorrect_count = unanswered_count = 0

    for question in questions:
        answer = answers_by_question.get(question.id)
        submitted = (answer.submitted_answer or "").strip() if answer else ""
        payload = serialize_attempt_answer(answer, question) if answer else {
            "question_id": question.id,
            "question_type": question.type,
            "question_text": question.text,
            "submitted_answer": None,
            "correctness": None,
            "awarded_marks": None,
        }

        if not submitted:
            unanswered_count += 1
        elif answer and answer.correctness:
            correct_count += 1
        else:
            incorrect_count += 1

        answers.append(payload)

    return {
        "attempt": serialize_attempt(attempt),
        "quiz": serialize_quiz(quiz),
        "questions": [serialize_question(question) for question in questions],
        "answers": answers,
        "correct_count": correct_count,
        "incorrect_count": incorrect_count,
        "unanswered_count": unanswered_count,
    }


def isoformat(value: datetime | None) -> str | None:
    return value.isoformat() if value else None