"""Request models used for validation of incoming API payloads."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

QuestionType = Literal["multiple_choice", "true_false", "short_answer"]
Difficulty = Literal["easy", "medium", "hard", "mixed"]


class QuizGenerateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    document_id: int
    difficulty: Difficulty = "medium"
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title cannot be blank.")
        return cleaned

    @field_validator("config")
    @classmethod
    def validate_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        question_count = value.get("question_count", 10)
        if not isinstance(question_count, int) or not 1 <= question_count <= 50:
            raise ValueError("question_count must be between 1 and 50.")

        types = value.get("question_types") or ["multiple_choice"]
        if not isinstance(types, list) or not types:
            raise ValueError("question_types must be a non-empty list.")
        allowed = {"multiple_choice", "true_false", "short_answer"}
        for item in types:
            if item not in allowed:
                raise ValueError(f"Unsupported question type: {item}")

        return value


class QuizUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    difficulty: Difficulty | None = None
    config: dict[str, Any] | None = None


class QuestionUpsert(BaseModel):
    id: int | None = None
    text: str = Field(min_length=1, max_length=2000)
    type: QuestionType = "multiple_choice"
    difficulty: str | None = None
    options: list[str] | None = None
    correct_answer: str | None = None
    explanation: str | None = None
    source_pages: list[int] | None = None
    order: int = 0

    @field_validator("options")
    @classmethod
    def validate_options(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [option.strip() for option in value if option and option.strip()]
        if len(cleaned) != len(set(option.lower() for option in cleaned)):
            raise ValueError("Answer options must be distinct.")
        return cleaned


class QuestionsReplaceRequest(BaseModel):
    questions: list[QuestionUpsert] = Field(min_length=1)


class SaveAnswersRequest(BaseModel):
    answers: list[dict[str, Any]] = Field(default_factory=list)


class ApiSettingsRequest(BaseModel):
    """Deliberately does NOT accept secrets: credentials stay on the backend."""

    default_question_count: int | None = Field(default=None, ge=1, le=50)
    default_difficulty: Difficulty | None = None