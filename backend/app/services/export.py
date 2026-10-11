"""Quiz and result export builders."""

from __future__ import annotations

import csv
import io
from typing import Any

from app.models import Attempt, Question, Quiz


def _questions(quiz: Quiz) -> list[Question]:
    return sorted(quiz.questions, key=lambda question: question.order)


def build_quiz_export(quiz: Quiz, include_answers: bool) -> dict[str, Any]:
    questions = _questions(quiz)

    exported: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        item: dict[str, Any] = {
            "number": index,
            "id": question.id,
            "type": question.type,
            "text": question.text,
            "options": question.options,
            "source_pages": [question.source_page] if question.source_page else [],
        }
        if include_answers:
            item["correct_answer"] = question.correct_answer
            item["explanation"] = question.explanation
            item["source_excerpt"] = question.source_excerpt
        exported.append(item)

    return {
        "format": "quizforge.quiz.v1",
        "quiz": {
            "id": quiz.id,
            "title": quiz.title,
            "difficulty": quiz.difficulty,
            "generation_method": quiz.generation_method,
            "config": quiz.config or {},
            "created_at": quiz.created_at,
            "document": {
                "id": quiz.document.id,
                "original_filename": quiz.document.original_filename,
                "page_count": quiz.document.page_count,
            }
            if quiz.document
            else None,
        },
        "includes_answers": include_answers,
        "question_count": len(exported),
        "questions": exported,
    }


def build_attempt_export(attempt: Attempt) -> dict[str, Any]:
    questions = _questions(attempt.quiz)
    answers = {answer.question_id: answer for answer in attempt.answers}

    rows: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        answer = answers.get(question.id)
        rows.append(
            {
                "number": index,
                "question_id": question.id,
                "question_text": question.text,
                "question_type": question.type,
                "options": question.options,
                "submitted_answer": answer.submitted_answer if answer else None,
                "correct_answer": question.correct_answer,
                "correct": bool(answer.correctness) if answer else False,
                "awarded_marks": answer.awarded_marks if answer else 0.0,
                "explanation": question.explanation,
                "source_pages": [question.source_page] if question.source_page else [],
            }
        )

    return {
        "format": "quizforge.attempt.v1",
        "grading_note": "Short answers are graded by exact or normalized text matching and are approximate.",
        "attempt": {
            "id": attempt.id,
            "quiz_id": attempt.quiz_id,
            "quiz_title": attempt.quiz.title,
            "started_at": attempt.started_at,
            "submitted_at": attempt.submitted_at,
            "duration_seconds": attempt.duration_seconds,
            "status": attempt.status,
            "score": attempt.score,
            "max_score": attempt.max_score,
            "percentage": attempt.percentage,
        },
        "answers": rows,
    }


def build_attempt_csv(attempt: Attempt) -> str:
    payload = build_attempt_export(attempt)
    buffer = io.StringIO()

    writer = csv.writer(buffer)
    writer.writerow(
        [
            "quiz_title",
            "attempt_id",
            "submitted_at",
            "score",
            "max_score",
            "percentage",
        ]
    )
    attempt_row = payload["attempt"]
    writer.writerow(
        [
            attempt_row["quiz_title"],
            attempt_row["id"],
            attempt_row["submitted_at"],
            attempt_row["score"],
            attempt_row["max_score"],
            attempt_row["percentage"],
        ]
    )

    writer.writerow([])
    writer.writerow(
        ["number", "question", "type", "your_answer", "correct_answer", "correct", "awarded_marks", "explanation"]
    )
    for row in payload["answers"]:
        writer.writerow(
            [
                row["number"],
                row["question_text"],
                row["question_type"],
                row["submitted_answer"] or "",
                row["correct_answer"] or "",
                "yes" if row["correct"] else "no",
                row["awarded_marks"],
                row["explanation"] or "",
            ]
        )

    return buffer.getvalue()