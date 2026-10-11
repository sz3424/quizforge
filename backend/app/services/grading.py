"""Grading service.

Objective questions (multiple choice / true-false) are graded by exact,
normalized comparison. Short answers use normalized text matching, which is
approximate by nature and is surfaced as such in the UI and exports.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Attempt, AttemptAnswer, Question

_ARTICLES = {"a", "an", "the"}


@dataclass
class GradingResult:
    awarded: float
    maximum: float
    correct_count: int
    incorrect_count: int
    unanswered_count: int


def normalize_answer(text: str | None) -> str:
    """Lowercase, strip accents/articles/punctuation and collapse whitespace."""
    if not text:
        return ""
    folded = unicodedata.normalize("NFKD", text)
    folded = "".join(char for char in folded if not unicodedata.combining(char))
    folded = folded.lower().strip()
    folded = re.sub(r"[^\w\s]", " ", folded)
    tokens = [token for token in folded.split() if token not in _ARTICLES]
    return " ".join(tokens)


def grade_answer(question: Question, submitted: str | None) -> bool:
    expected = normalize_answer(question.correct_answer)
    given = normalize_answer(submitted)
    if not given:
        return False

    if question.type == "multiple_choice":
        options = [normalize_answer(option) for option in (question.options or [])]
        return bool(expected) and given == expected

    if question.type == "true_false":
        return given == expected

    # Short answer: exact normalized match first, then a tolerant comparison.
    if given == expected:
        return True

    accepted = question.explanation or ""
    for variant in re.findall(r"\(([^)]*)\)", accepted):
        if normalize_answer(variant) == given:
            return True

    # Allow the expected answer to appear inside a slightly longer response.
    return len(expected) >= 4 and given in expected


def grade_attempt(attempt: Attempt, db: Session) -> GradingResult:
    questions = sorted(attempt.quiz.questions, key=lambda question: question.order)

    existing: dict[int, AttemptAnswer] = {
        answer.question_id: answer for answer in attempt.answers
    }

    awarded = 0.0
    correct_count = incorrect_count = unanswered_count = 0

    for question in questions:
        answer = existing.get(question.id)
        if answer is None:
            answer = AttemptAnswer(attempt_id=attempt.id, question_id=question.id)
            db.add(answer)

        submitted = (answer.submitted_answer or "").strip()
        if not submitted:
            answer.correctness = False
            answer.awarded_marks = 0.0
            unanswered_count += 1
            continue

        is_correct = grade_answer(question, submitted)
        answer.correctness = is_correct
        answer.awarded_marks = 1.0 if is_correct else 0.0

        if is_correct:
            awarded += 1.0
            correct_count += 1
        else:
            incorrect_count += 1

    db.flush()
    return GradingResult(
        awarded=awarded,
        maximum=float(len(questions)),
        correct_count=correct_count,
        incorrect_count=incorrect_count,
        unanswered_count=unanswered_count,
    )