"""Regression tests for the offline question generator.

Targets the specific defects reported:

* random single-word distractor options ("uses", "across", "address")
* malformed / ungrammatical questions
* near-duplicate questions inside one quiz
* questions built from instructions, headers or existing practice questions
* fabricating options when the source has nothing useful to say

Run:  .\\venv\\Scripts\\python.exe -m tests.test_generator
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.services.content_extraction import clean_lines, extract_facts  # noqa: E402
from app.services.question_generation import (  # noqa: E402
    GenerationError,
    VALID_TYPES,
    generate_offline,
    normalize,
)

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label} :: {detail}")


# A document that mixes real teaching content with the exact kinds of noise
# reported in the bug: instructions, running headers, practice questions and an
# answer key, plus filler words that previously became distractors.
MESSY_DOCUMENT = """
Digital Electronics

Digital Electronics Fundamentals

Page 1 of 3

Instructions: Answer the following questions based on the passage.

Chapter 1

A diode is a semiconductor device that allows current to flow in one direction only.
A NOT gate is a logic gate that inverts its single input signal.
An AND gate is a logic gate that outputs a high signal only when all inputs are high.
A diode contains a P-N junction which allows unidirectional current flow.
The Zener diode operates in the reverse breakdown region to provide voltage regulation.
A transistor is a three terminal semiconductor device used to amplify electrical signals.
An op-amp is a high gain differential amplifier used in analog circuits.
The rectifier uses diodes to convert alternating current into direct current.
A photodiode is a semiconductor device that detects light and converts it into electrical current.
A flip-flop is a sequential circuit that stores one bit of binary data between clock edges.
Combinational logic is a type of logic circuit whose output depends only on the present inputs.
Sequential logic is a type of logic circuit whose output depends on present and past outputs.
The clock synchronisation process aligns timing across circuit components.
Excess current causes permanent damage to a semiconductor junction.

Question 1: Which statement about diodes is correct?
a) Diodes allow current in both directions.
b) Diodes are used only in analog circuits.
c) Diodes allow current in one direction.

Q2. Define rectification.
2. What is a transistor used for?

Answers: 1-c 2-b
Ans: 1-c

Page 2 of 3

The interconnection uses address and data buses.
acknowledgements acknowledges
"""


def as_pages(text: str) -> list:
    return [(1, text)]


def all_options(questions) -> list[str]:
    options: list[str] = []
    for question in questions:
        options.extend(question.options or [])
    return options


def test_noise_filtering() -> None:
    print("\n[1] Noise filtering")
    pages = as_pages(MESSY_DOCUMENT)
    lines = clean_lines(pages)
    kept = [line.text for line in lines]

    joined = " ".join(kept).lower()

    check("instruction lines removed", "instructions:" not in joined, str(kept[:3]))
    check("running page header removed", "page 1 of 3" not in joined, "page marker survived")
    check("bare chapter heading removed", "chapter 1" not in joined, "chapter marker survived")
    check("existing practice question removed", "which statement about diodes is correct" not in joined, "practice Q survived")
    check("answer key removed", "answers: 1-c" not in joined, "answer key survived")
    check("filler/garbage line removed", "acknowledgements acknowledges" not in joined, "garbage survived")
    check(
        "real content kept",
        any("semiconductor device" in text for text in kept),
        "legitimate definition was dropped",
    )


def test_fact_extraction() -> None:
    print("\n[2] Fact extraction")
    pages = as_pages(MESSY_DOCUMENT)
    lines = clean_lines(pages)
    facts = extract_facts(lines)

    check("facts extracted", len(facts) >= 6, f"only {len(facts)} facts")

    subjects = [normalize(fact.subject) for fact in facts]
    check(
        "facts come from real content, not instructions",
        not any("question" in subject or "answer" in subject for subject in subjects),
        str(subjects),
    )

    kinds = {fact.kind for fact in facts}
    check("definitions detected", "definition" in kinds, str(kinds))

    details = [fact.detail for fact in facts]
    check(
        "no fact detail is a single stopword-ish word",
        all(len(detail.split()) >= 4 for detail in details),
        str([d for d in details if len(d.split()) < 4]),
    )

    check(
        "no detail is a random one-word token like 'uses'/'across'/'address'",
        not any(normalize(detail) in {"uses", "across", "address", "acknowledgements"} for detail in details),
        str(details),
    )


def test_generated_questions_are_meaningful() -> None:
    print("\n[3] Generated question quality")
    pages = as_pages(MESSY_DOCUMENT)
    questions = generate_offline(pages, 8, list(VALID_TYPES), "medium")

    check("questions produced", len(questions) >= 3, f"only {len(questions)}")

    options = all_options(questions)
    check(
        "no single-word options",
        all(len(option.split()) >= 3 for option in options),
        str([o for o in options if len(o.split()) < 3]),
    )

    check(
        "no option is a random document word",
        not any(normalize(option) in {"uses", "across", "address", "acknowledgements"} for option in options),
        str(options),
    )

    check(
        "options are distinct within each question",
        all(len({normalize(o) for o in (q.options or [])}) == len(q.options or []) for q in questions if q.options),
        "duplicate options found",
    )

    check(
        "exactly one correct answer matches an option",
        all(normalize(q.correct_answer) in {normalize(o) for o in q.options} for q in questions if q.options),
        "correct answer missing from options",
    )

    check(
        "every question has an explanation",
        all(question.explanation.strip() for question in questions),
        str([q.text for q in questions if not q.explanation.strip()]),
    )

    check(
        "every question cites a source page",
        all(question.source_pages for question in questions),
        str([q.text for q in questions if not q.source_pages]),
    )


def test_true_false_grammar() -> None:
    print("\n[4] True/false grammar and consistency")
    pages = as_pages(MESSY_DOCUMENT)
    questions = generate_offline(pages, 10, ["true_false"], "medium")

    tf = [q for q in questions if q.type == "true_false"]
    check("true/false questions produced", len(tf) >= 1, f"only {len(tf)}")

    for question in tf:
        check(
            f"ends with punctuation: {question.text[:48]}...",
            question.text.rstrip().endswith((".", "?", "!")),
            question.text,
        )
        body = question.text.split(":", 1)[-1].strip()
        check(
            f"statement is a full sentence: {body[:48]}...",
            body[:1].isupper() and "  " not in body,
            body,
        )
        check(
            f"answer is true/false: {question.correct_answer}",
            question.correct_answer in ("true", "false"),
            question.correct_answer,
        )

    for question in tf:
        if question.correct_answer == "false":
            check(
                "false statement is supported by an explanation",
                bool(question.explanation),
                question.text,
            )


BOILERPLATE_PREFIXES = (
    "according to the document, which statement correctly describes",
    "according to the document, which of the following is true about",
    "true or false:",
    "which term does the document describe as:",
    "the ",
)


def strip_stem(text: str) -> str:
    """Remove the shared question stem so similarity reflects real content.

    Two questions about "the diode" and "the transistor" legitimately share a
    stem; only the distinguishing part matters when judging duplication.
    """
    lowered = normalize(text)
    for prefix in BOILERPLATE_PREFIXES:
        if lowered.startswith(prefix):
            return lowered[len(prefix):].strip(" ?")
    return lowered.strip(" ?")


def test_no_duplicate_questions() -> None:
    print("\n[5] Duplicate / near-duplicate questions")
    pages = as_pages(MESSY_DOCUMENT)
    questions = generate_offline(pages, 12, list(VALID_TYPES), "medium")

    texts = [normalize(q.text) for q in questions]
    check("no exact duplicate question text", len(texts) == len(set(texts)), str(texts))

    # The same underlying fact must never be asked twice.
    content_keys = [
        f"{normalize(q.correct_answer)}|{normalize(q.source_excerpt or '')}" for q in questions
    ]
    check(
        "no two questions ask about the same fact",
        len(content_keys) == len(set(content_keys)),
        "duplicate content key detected",
    )

    # Near-duplicate detection on the distinguishing content only.
    bodies = [set(strip_stem(q.text).split()) for q in questions]
    worst = 0.0
    worst_pair = ""
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            union = bodies[i] | bodies[j]
            if not union:
                continue
            overlap = len(bodies[i] & bodies[j]) / len(union)
            if overlap > worst:
                worst = overlap
                worst_pair = f"{strip_stem(questions[i].text)} || {strip_stem(questions[j].text)}"
    check(
        "no near-duplicate question bodies (Jaccard < 0.8)",
        worst < 0.8,
        f"worst overlap {worst:.2f} between {worst_pair}",
    )

    # One fact must not spawn several questions.
    check(
        "each question uses a distinct source excerpt",
        len({normalize(q.source_excerpt or "") for q in questions}) == len(questions),
        "two questions share a source excerpt",
    )


def test_insufficient_content_is_rejected() -> None:
    print("\n[6] Insufficient content is refused, not padded")

    empty = generate_offline_safe("", 5)
    check("empty document raises GenerationError", empty is None, "no error raised")

    junk = generate_offline_safe(
        "Page 1 of 2\n\nInstructions: Read the passage.\n\nChapter 1\n\nFoo bar baz qux quux.",
        5,
    )
    check("noise-only document raises GenerationError", junk is None, "junk was turned into questions")

    thin = generate_offline_safe(
        "The sky is blue.\n\nNothing else useful appears in this document at all.",
        5,
    )
    check("thin document yields no invented questions", thin is None, "fabricated questions from thin content")


def generate_offline_safe(text: str, count: int):
    try:
        return generate_offline(as_pages(text), count, ["multiple_choice"], "medium")
    except GenerationError:
        return None


def test_quality_over_quantity() -> None:
    print("\n[7] Quality over quantity")
    pages = as_pages(MESSY_DOCUMENT)
    requested = 20
    questions = generate_offline(pages, requested, list(VALID_TYPES), "medium")

    check(
        f"does not fabricate to reach {requested} questions",
        len(questions) <= requested,
        f"returned {len(questions)}",
    )
    check("still returns a useful quiz", len(questions) >= 3, f"only {len(questions)}")

    bad = [
        q
        for q in questions
        if q.type == "multiple_choice"
        and (
            len(q.options or []) != 4
            or len({normalize(o) for o in q.options or []}) != 4
            or normalize(q.correct_answer) not in {normalize(o) for o in q.options}
        )
    ]
    check("every MCQ has 4 distinct options and a valid key", not bad, str([q.text for q in bad]))


def test_offline_labelling() -> None:
    print("\n[8] Offline labelling")
    from app.services.question_generation import provider_status

    status = provider_status()
    check("provider reported unconfigured in test env", status["configured"] is False, str(status))

    pages = as_pages(MESSY_DOCUMENT)
    questions = generate_offline(pages, 5, ["multiple_choice"], "medium")
    check("questions carry no false AI attribution", all("gpt" not in q.explanation.lower() for q in questions), "AI attribution leaked")


def main() -> int:
    test_noise_filtering()
    test_fact_extraction()
    test_generated_questions_are_meaningful()
    test_true_false_grammar()
    test_no_duplicate_questions()
    test_insufficient_content_is_rejected()
    test_quality_over_quantity()
    test_offline_labelling()

    print("\n" + "=" * 60)
    print(f"PASSED: {len(PASSED)}   FAILED: {len(FAILED)}")
    if FAILED:
        print("\nFailures:")
        for failure in FAILED:
            print(f"  - {failure}")
        return 1
    print("All generator regression tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
