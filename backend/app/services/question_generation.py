"""Question generation engine.

Two explicit paths:

* ``llm``     – uses the configured OpenAI-compatible provider.
* ``offline`` – a deterministic, extraction-based generator that works with no
  API key. Its questions are clearly labelled so they are never presented as
  "AI generated".

Both paths ground every question in text extracted from the uploaded PDF.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import string
from dataclasses import dataclass, field
from typing import Any, Iterable

from app.services.content_extraction import Fact, clean_lines, extract_facts

logger = logging.getLogger(__name__)

VALID_TYPES = ("multiple_choice", "true_false", "short_answer")

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with",
    "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those",
    "as", "at", "by", "from", "it", "its", "which", "who", "whom", "can", "will", "would",
    "should", "could", "may", "might", "do", "does", "did", "not", "than", "then", "so",
    "such", "there", "their", "them", "they", "we", "you", "our", "your", "have", "has",
    "had", "into", "out", "up", "down", "over", "under", "also", "more", "most", "other",
    "some", "each", "any", "all", "both", "few", "many", "much", "very", "can", "using",
}


class GenerationError(RuntimeError):
    """Raised when questions cannot be produced from the supplied document."""


@dataclass
class GeneratedQuestion:
    text: str
    type: str
    correct_answer: str
    explanation: str = ""
    options: list[str] | None = None
    source_pages: list[int] = field(default_factory=list)
    source_excerpt: str | None = None
    difficulty: str | None = None


@dataclass
class GenerationResult:
    questions: list[GeneratedQuestion]
    method: str
    provider_label: str


# --------------------------------------------------------------------------- #
# Provider configuration
# --------------------------------------------------------------------------- #


def provider_status() -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o").strip() or "gpt-4o"
    base_url = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")

    missing = []
    if not api_key:
        missing.append("OPENAI_API_KEY")
    if model == "your_openai_model_here":
        missing.append("OPENAI_MODEL")

    configured = not missing
    return {
        "configured": configured,
        "provider": "OpenAI-compatible",
        "model": model,
        "api_base": base_url,
        "missing_variables": missing,
        "message": (
            "AI provider configured. Extracted text from the pages used for generation is sent to this provider."
            if configured
            else "AI provider is not configured. Quiz generation will use the labelled offline generator."
        ),
    }


# --------------------------------------------------------------------------- #
# Chunking
# --------------------------------------------------------------------------- #

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(])")
MAX_CHUNK_CHARS = 6000


def split_sentences(text: str) -> list[str]:
    parts = [part.strip() for part in SENTENCE_SPLIT.split(text or "") if part.strip()]
    return parts or ([text.strip()] if text and text.strip() else [])


def chunk_pages(pages: list[tuple[int, str]], max_chars: int = MAX_CHUNK_CHARS) -> list[dict[str, Any]]:
    """Group page text into chunks, preferring sentence boundaries."""
    chunks: list[dict[str, Any]] = []
    buffer: list[str] = []
    buffer_pages: list[int] = []
    size = 0

    for page_number, text in pages:
        for sentence in split_sentences(text):
            if size + len(sentence) > max_chars and buffer:
                chunks.append({"text": " ".join(buffer), "pages": sorted(set(buffer_pages))})
                buffer, buffer_pages, size = [], [], 0
            buffer.append(sentence)
            buffer_pages.append(page_number)
            size += len(sentence) + 1

    if buffer:
        chunks.append({"text": " ".join(buffer), "pages": sorted(set(buffer_pages))})

    return chunks


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def normalize(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def validate_question(question: GeneratedQuestion) -> None:
    if not question.text or len(question.text.strip()) < 8:
        raise GenerationError("Generated question has no usable text.")
    if question.type not in VALID_TYPES:
        raise GenerationError(f"Invalid question type: {question.type}")
    if not question.correct_answer or not question.correct_answer.strip():
        raise GenerationError("Generated question has no correct answer.")

    if question.type == "multiple_choice":
        options = [option for option in (question.options or []) if option and option.strip()]
        if len(options) < 3:
            raise GenerationError("Multiple-choice questions need at least three options.")
        normalized = [normalize(option) for option in options]
        if len(set(normalized)) != len(normalized):
            raise GenerationError("Multiple-choice options must be distinct.")
        if normalize(question.correct_answer) not in normalized:
            raise GenerationError("Correct answer is not one of the provided options.")


def deduplicate(questions: Iterable[GeneratedQuestion]) -> list[GeneratedQuestion]:
    seen: set[str] = set()
    unique: list[GeneratedQuestion] = []
    for question in questions:
        fingerprint = normalize(question.text)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique.append(question)
    return unique


# --------------------------------------------------------------------------- #
# LLM generation
# --------------------------------------------------------------------------- #

SYSTEM_PROMPT = (
    "You generate study questions grounded strictly in the supplied PDF text. "
    "You never introduce facts that are absent from the source. "
    "You reply with a single JSON object and nothing else."
)


def build_prompt(chunks: list[dict[str, Any]], count: int, types: list[str], difficulty: str) -> str:
    context_blocks = []
    for index, chunk in enumerate(chunks, start=1):
        context_blocks.append(f"[chunk {index} | pages {chunk['pages']}]\n{chunk['text']}")

    return (
        "Create {count} exam questions from the study material below.\n\n"
        "Difficulty: {difficulty}\n"
        "Question types allowed: {types}\n\n"
        "Rules:\n"
        "1. Every answer must be supported by the text.\n"
        "2. multiple_choice: exactly 4 distinct options, exactly one correct.\n"
        "3. true_false: the statement must be unambiguously true or false.\n"
        "4. short_answer: give the shortest accepted answer string.\n"
        "5. Record the page numbers that support each answer.\n"
        "6. Do not repeat the same fact across questions.\n\n"
        "Return JSON of this exact shape:\n"
        '{{"questions":[{{"text":"...","type":"multiple_choice","options":["..","..","..",".."],'
        '"correct_answer":"..","explanation":"..","source_pages":[1],"source_excerpt":".."}}]}}\n\n'
        "STUDY MATERIAL:\n{context}"
    ).format(
        count=count,
        difficulty=difficulty,
        types=", ".join(types),
        context="\n\n".join(context_blocks),
    )


def parse_llm_payload(raw: str) -> list[GeneratedQuestion]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"```$", "", text).strip()

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise GenerationError(f"Provider returned malformed JSON: {exc}") from exc

    items = payload.get("questions") if isinstance(payload, dict) else payload
    if not isinstance(items, list) or not items:
        raise GenerationError("Provider response contained no questions.")

    questions: list[GeneratedQuestion] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        questions.append(
            GeneratedQuestion(
                text=str(item.get("text", "")).strip(),
                type=str(item.get("type", "multiple_choice")).strip().lower(),
                options=[str(option) for option in (item.get("options") or [])],
                correct_answer=str(item.get("correct_answer", "")).strip(),
                explanation=str(item.get("explanation", "")).strip(),
                source_pages=[int(page) for page in (item.get("source_pages") or []) if str(page).isdigit()],
                source_excerpt=(str(item.get("source_excerpt")).strip() or None),
                difficulty=item.get("difficulty"),
            )
        )

    return questions


def generate_with_llm(
    chunks: list[dict[str, Any]],
    count: int,
    types: list[str],
    difficulty: str,
    max_retries: int = 2,
) -> list[GeneratedQuestion]:
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise GenerationError("The openai package is not installed on the backend.") from exc

    status = provider_status()
    client = OpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1"),
        timeout=60.0,
        max_retries=2,
    )

    last_error = ""
    for attempt in range(max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=status["model"],
                temperature=0.2,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_prompt(chunks, count, types, difficulty)},
                ],
            )
            content = response.choices[0].message.content or ""
            questions = parse_llm_payload(content)
            validated = []
            for question in questions:
                try:
                    validate_question(question)
                    validated.append(question)
                except GenerationError as exc:
                    logger.warning("Dropping invalid generated question: %s", exc)
            validated = deduplicate(validated)
            if not validated:
                raise GenerationError("Every generated question failed validation.")
            return validated[:count]
        except GenerationError as exc:
            last_error = str(exc)
            logger.warning("Generation attempt %s rejected: %s", attempt + 1, exc)
        except Exception as exc:  # provider/network failures
            logger.exception("Provider call failed")
            raise GenerationError(f"Question generation provider failed: {type(exc).__name__}") from exc

    raise GenerationError(last_error or "Question generation failed validation.")




# --------------------------------------------------------------------------- #
# Offline extraction-based generator
# --------------------------------------------------------------------------- #


def _capitalise(text: str) -> str:
    text = text.strip()
    if not text:
        return text
    return text[0].upper() + text[1:]


def _ensure_period(text: str) -> str:
    text = text.strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text


def _trim_detail(detail: str, max_chars: int = 150) -> str:
    detail = detail.strip()
    if len(detail) <= max_chars:
        return detail
    return detail[: max_chars - 3].rsplit(" ", 1)[0] + "..."


def _statement_about(fact: Fact) -> str:
    """A complete, grammatical sentence stating the fact."""
    return _ensure_period(f"{_capitalise(fact.subject)} {_verb_for(fact.kind)} {_trim_detail(fact.detail)}")


def _verb_for(kind: str) -> str:
    return {"definition": "is", "property": "has", "cause": "causes"}.get(kind, "is")


def _distractors(fact: Fact, pool: list[Fact], need: int) -> list[str]:
    """Plausible-but-wrong options taken from other real facts in the document.

    Each distractor describes a *different* subject, so it is unambiguously wrong
    for the subject under test while still being on-topic. Uniqueness is enforced
    within the question only -- the same detail may legitimately be a distractor
    in a different question.
    """
    chosen: list[str] = []
    own = normalize(fact.detail)
    seen = {own}

    for candidate in pool:
        if len(chosen) >= need:
            break
        if normalize(candidate.subject) == normalize(fact.subject):
            continue
        text = _trim_detail(candidate.detail)
        key = normalize(text)
        if key in seen:
            continue
        seen.add(key)
        chosen.append(text)

    return chosen


def _definition_mcq(fact: Fact, pool: list[Fact]) -> GeneratedQuestion | None:
    distractors = _distractors(fact, pool, 3)
    if len(distractors) < 3:
        return None

    options = [_trim_detail(fact.detail), *distractors]

    return GeneratedQuestion(
        text=_ensure_period(
            f"According to the document, which statement correctly describes {_article(fact.subject)}?"
        ),
        type="multiple_choice",
        options=options,
        correct_answer=options[0],
        explanation=f'The document states: "{fact.excerpt}"',
        source_pages=list(fact.pages),
        source_excerpt=fact.excerpt,
    )


def _property_mcq(fact: Fact, pool: list[Fact]) -> GeneratedQuestion | None:
    distractors = _distractors(fact, pool, 3)
    if len(distractors) < 3:
        return None

    options = [_trim_detail(fact.detail), *distractors]

    return GeneratedQuestion(
        text=_ensure_period(
            f"According to the document, which of the following is true about {_article(fact.subject)}?"
        ),
        type="multiple_choice",
        options=options,
        correct_answer=options[0],
        explanation=f'The document states: "{fact.excerpt}"',
        source_pages=list(fact.pages),
        source_excerpt=fact.excerpt,
    )


def _definition_true_false(
    fact: Fact,
    pool: list[Fact],
    make_false: bool,
) -> GeneratedQuestion | None:
    """True uses the document's own sentence; false swaps in another subject.

    Both variants are built from the verbatim source sentence, so the statement is
    always complete and grammatical.
    """
    excerpt = fact.excerpt or _statement_about(fact)

    if not make_false:
        return GeneratedQuestion(
            text=f"True or false: {_ensure_period(excerpt)}",
            type="true_false",
            correct_answer="true",
            explanation=f'The document states: "{excerpt}"',
            source_pages=list(fact.pages),
            source_excerpt=excerpt,
        )

    other = next(
        (
            candidate
            for candidate in pool
            if normalize(candidate.subject) != normalize(fact.subject) and candidate.raw_subject
        ),
        None,
    )
    if other is None or not fact.raw_subject:
        return None

    # Swap only the subject phrase, keeping the predicate intact.
    statement = excerpt.replace(fact.raw_subject, other.raw_subject, 1)
    if normalize(statement) == normalize(excerpt):
        return None

    return GeneratedQuestion(
        text=f"True or false: {_ensure_period(statement)}",
        type="true_false",
        correct_answer="false",
        explanation=(
            f'The document attributes this description to "{fact.subject}", not "{other.subject}". '
            f'It states: "{excerpt}"'
        ),
        source_pages=list(fact.pages),
        source_excerpt=excerpt,
    )


def _reverse_definition_short_answer(fact: Fact) -> GeneratedQuestion:
    """'Which term is defined as X?' -- answer is the subject, so exact grading works."""
    return GeneratedQuestion(
        text=_ensure_period(
            f'Which term does the document describe as: "{_trim_detail(fact.detail)}"?'
        ),
        type="short_answer",
        correct_answer=fact.subject,
        explanation=f'The document states: "{fact.excerpt}"',
        source_pages=list(fact.pages),
        source_excerpt=fact.excerpt,
    )


def _article(subject: str) -> str:
    """Add a leading article only when the subject needs one."""
    if re.match(r"^(?:the|a|an|its|their|these|those)\b", subject, re.IGNORECASE):
        return subject
    return f"the {subject}"


def _plan_questions(
    facts: list[Fact],
    types: list[str],
    count: int,
) -> list[tuple[str, Fact]]:
    """Choose which fact becomes which question type, never reusing a fact.

    Walks the fact list once and never looks ahead, so a type that a given fact
    cannot support simply advances the rotation instead of consuming the rest
    of the document.
    """
    # Definitions first: they support every question type.
    ordered = [fact for fact in facts if fact.kind == "definition"]
    ordered += [fact for fact in facts if fact.kind in ("property", "cause")]

    requested = [item for item in types if item in VALID_TYPES] or ["multiple_choice"]

    plan: list[tuple[str, Fact]] = []
    rotation = 0

    for fact in ordered:
        if len(plan) >= count:
            break

        # Only definitions can be turned into a keyed statement question.
        supported = requested if fact.kind == "definition" else ["multiple_choice"]

        wanted = supported[rotation % len(supported)]
        plan.append((wanted, fact))
        rotation += 1

    return plan


def generate_offline(
    pages: list[tuple[int, str]],
    count: int,
    types: list[str],
    difficulty: str,
) -> list[GeneratedQuestion]:
    """Build questions from cleaned, fact-bearing content only.

    Takes the raw ``(page_number, text)`` pairs rather than pre-joined chunks so
    that line boundaries survive -- the noise filter and fact patterns are both
    line-oriented.

    If the document does not contain enough teachable content, fewer questions
    are returned rather than padding the quiz with low-quality items.
    """
    lines = clean_lines(pages)
    if not lines:
        raise GenerationError(
            "No study content was found once headers, instructions and practice "
            "questions were removed. Try a text-based PDF with real explanations."
        )

    facts = extract_facts(lines)
    if len(facts) < 2:
        raise GenerationError(
            "This document does not contain enough definitions or stated properties "
            "to build reliable questions from."
        )

    wanted_types = [item for item in types if item in VALID_TYPES] or ["multiple_choice"]
    plan = _plan_questions(facts, wanted_types, count)

    built: list[GeneratedQuestion] = []
    seen_questions: set[str] = set()
    used_content: set[str] = set()
    source_lines = {normalize(line.text) for line in lines}
    tf_counter = 0

    for kind, fact in plan:
        question: GeneratedQuestion | None = None

        if kind == "multiple_choice":
            builder = _property_mcq if fact.kind in ("property", "cause") else _definition_mcq
            question = builder(fact, facts)
        elif kind == "true_false":
            # Alternate so the answer key is not all "true".
            question = _definition_true_false(fact, facts, make_false=(tf_counter % 2 == 1))
            if question is not None:
                tf_counter += 1
        elif kind == "short_answer":
            question = _reverse_definition_short_answer(fact)

        if question is None:
            continue

        # Never re-use an existing practice question from the document verbatim.
        if normalize(question.text) in source_lines:
            continue

        # Duplicate detection compares the underlying content, not the wording.
        # Two questions sharing a template stem ("...true about the X layer")
        # are legitimately different, but two asking about the same fact are not.
        content_key = f"{normalize(question.correct_answer)}|{normalize(question.source_excerpt or '')}"
        if content_key in used_content:
            continue

        text_key = normalize(question.text)
        if text_key in seen_questions:
            continue

        used_content.add(content_key)
        seen_questions.add(text_key)

        # Options must be real multi-word phrases, never bare tokens.
        if question.type == "multiple_choice":
            if any(len(option.split()) < 3 for option in question.options or []):
                continue

        try:
            validate_question(question)
        except GenerationError as exc:
            logger.warning("Discarding invalid offline question: %s", exc)
            continue

        built.append(question)

        if len(built) >= count:
            break

    if not built:
        raise GenerationError(
            "Could not build any reliable questions from this document's content."
        )

    return deduplicate(built)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def generate(
    pages: list[tuple[int, str]],
    count: int,
    types: list[str],
    difficulty: str,
    topic_pages: list[int] | None = None,
    prefer_llm: bool = True,
) -> GenerationResult:
    if not any(text.strip() for _, text in pages):
        raise GenerationError(
            "This PDF has no selectable text. It is likely a scan or image-only file, and OCR is not supported."
        )

    if topic_pages:
        selected = [(number, text) for number, text in pages if number in set(topic_pages)]
        if selected:
            pages = selected

    chunks = chunk_pages(pages)
    if not chunks:
        raise GenerationError("No usable text was extracted from this document.")

    types = [item for item in types if item in VALID_TYPES] or ["multiple_choice"]

    if prefer_llm and provider_status()["configured"]:
        questions = generate_with_llm(chunks, count, types, difficulty)
        status = provider_status()
        return GenerationResult(questions, "ai", f"{status['provider']} - {status['model']}")

    questions = generate_offline(pages, count, types, difficulty)
    return GenerationResult(questions, "offline", "Offline extraction generator (no AI provider configured)")
