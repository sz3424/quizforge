"""Content extraction for source-grounded question generation.

The offline generator needs *meaningful* study content, so this module turns
raw PDF text into two things:

1. :func:`clean_lines`  -- removes page furniture (headers/footers), examiner
   instructions, existing practice questions and answer keys.
2. :func:`extract_facts` -- recognises definitions, properties and
   cause/effect statements, keeping the subject and the meaningful detail so a
   question can be built around real content.

Everything here is deterministic and unit-testable.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

# --------------------------------------------------------------------------- #
# Noise filtering
# --------------------------------------------------------------------------- #

# Lines that address the student rather than teach the subject.
INSTRUCTION_PATTERNS = [
    r"^\s*instructions?\s*[:.\-]",
    r"^\s*answer\s+(?:the\s+)?following",
    r"^\s*(?:choose|select|circle|tick|mark|fill|complete|write|list|name)\s+the\b",
    r"^\s*for\s+each\s+of\s+the\s+following",
    r"^\s*read\s+the\s+(?:following|passage|text)",
    r"^\s*note\s*[:\-]",
    r"^\s*hint\s*[:\-]",
    r"^\s*activity\s*\d*\s*[:.\-]",
    r"^\s*worksheet\s*[:\-]",
    r"^\s*revision\s*questions?\s*[:\-]",
    r"^\s*questions?\s*\d*\s*[:.\-]\s*$",
]

# Existing questions / answer keys that must never become new questions.
PRACTICE_QUESTION_PATTERNS = [
    r"^\s*q(?:uestion)?\.?\s*\d+\s*[.):\-]",
    r"^\s*(?:question|problem|item)\s*\d+\s*[:.\-]",
    r"^\s*\d+\s*[.)]\s+\S+",            # numbered items: "2. Name the layers"
    r"^\s*[a-e]\s*[.)]\s+\S+",
    r"^\s*example\s*\d*\s*[:.\-]",
    r"^\s*e\.?g\.?,?\s",
    r"^\s*(?:true|false)\s*[:.\-]\s",
    # Interrogatives are questions, not statements we can turn into facts.
    r"^\s*(?:which|what|who|whom|whose|when|where|why|how|is|are|does|do|can|will|"
    r"would|should|name|list|state|define|explain|describe|mention|write)\b",
]

ANSWER_KEY_PATTERNS = [
    r"^\s*ans(?:wer)?s?\s*[:.\-]",
    r"^\s*key\s*[:.\-]",
    r"^\s*\d+\s*[.)]\s*[\-–]?\s*[a-e]\b",
    r"^\s*[a-e]\s*[\-–:]\s*\w+",
    r"^\s*mark\s*(?:scheme)?\s*[:.\-]",
]

# Running heads / page furniture.
PAGE_FURNITURE_PATTERNS = [
    r"^\s*page\s+\d+(\s+of\s+\d+)?\s*$",
    r"^\s*chapter\s+\d+\s*$",
    r"^\s*unit\s+\d+\s*$",
    r"^\s*section\s+[a-z0-9.]+\s*$",
    r"^\s*[-–—_=*~\s]*\d+\s*[-–—_=*~\s]*$",          # bare page numbers
    r"^\s*(?:copyright|©)\s*\d{4}",
    r"^\s*https?://\S+$",
    r"^\s*www\.\S+$",
]

ALL_NOISE_PATTERNS = (
    INSTRUCTION_PATTERNS + PRACTICE_QUESTION_PATTERNS + ANSWER_KEY_PATTERNS + PAGE_FURNITURE_PATTERNS
)

_COMPILED_NOISE = [re.compile(pattern, re.IGNORECASE) for pattern in ALL_NOISE_PATTERNS]

# Very short fragments carry almost no teaching content on their own.
MIN_LINE_CHARS = 25
# A line longer than this is almost certainly a paragraph, not a crisp statement.
MAX_LINE_CHARS = 320
# Real statements repeat enough vocabulary to be reconstructible. This drops
# headers, stray tokens and lines like "acknowledgements acknowledges".
MIN_DISTINCT_WORDS = 5
# Fraction of characters that must be letters (rejects citation/garbage lines).
MIN_ALPHA_RATIO = 0.7


@dataclass
class Line:
    text: str
    page: int


@dataclass
class Fact:
    """A single teachable statement recovered from the document."""

    subject: str
    detail: str
    kind: str  # definition | property | cause
    pages: list[int] = field(default_factory=list)
    excerpt: str = ""
    # The subject exactly as it appears in the excerpt, so the sentence can be
    # rebuilt with a different subject without losing its leading article.
    raw_subject: str = ""

    @property
    def fingerprint(self) -> str:
        return f"{self.kind}:{normalize(self.subject)}:{normalize(self.detail)[:60]}"


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _looks_like_noise(line: str) -> bool:
    return any(pattern.search(line) for pattern in _COMPILED_NOISE)


def _is_low_information(line: str) -> bool:
    """Reject lines that cannot support a question."""
    words = re.findall(r"[A-Za-z][A-Za-z\-']*", line)
    if len({word.lower() for word in words}) < MIN_DISTINCT_WORDS:
        return True
    alpha = sum(char.isalpha() for char in line)
    if alpha < len(line) * MIN_ALPHA_RATIO:
        return True
    return False


def clean_lines(pages: list[tuple[int, str]]) -> list[Line]:
    """Drop page furniture, instructions, practice questions and answer keys.

    Also removes running headers/footers: short lines whose text repeats across
    two or more different pages.
    """
    raw: list[Line] = []
    for page_number, text in pages:
        for chunk in re.split(r"\n+", text or ""):
            stripped = chunk.strip()
            if not stripped:
                continue
            if len(stripped) < MIN_LINE_CHARS or len(stripped) > MAX_LINE_CHARS:
                continue
            # A line ending in "?" is already a question. Study notes rarely need
            # us to manufacture one, and this reliably removes existing practice
            # and review questions that would otherwise be copied verbatim.
            if stripped.endswith("?"):
                continue
            if _looks_like_noise(stripped) or _is_low_information(stripped):
                continue
            raw.append(Line(stripped, page_number))

    # Drop short lines that repeat on multiple pages (running headers/footers).
    page_spread: dict[str, set[int]] = {}
    for line in raw:
        page_spread.setdefault(normalize(line.text), set()).add(line.page)

    repeated = {text for text, seen in page_spread.items() if len(seen) > 1 and len(text) < 70}

    return [line for line in raw if normalize(line.text) not in repeated]


# --------------------------------------------------------------------------- #
# Fact extraction
# --------------------------------------------------------------------------- #

DEFINITION_PATTERNS = [
    # "X is called/known as/referred to as/defined as Y"
    re.compile(
        r"^(?P<s>.{2,60}?)\s+(?:is|are)\s+(?:commonly\s+|usually\s+|often\s+)?"
        r"(?:called|known as|referred to as|defined as|termed|used to describe)\s+(?P<d>.+)$",
        re.IGNORECASE,
    ),
    # Glossary style "Term: definition" / "Term - definition"
    re.compile(r"^(?P<s>[A-Z][\w \-]{2,50}?)\s*[:\-–]\s+(?P<d>.{15,})$"),
    # "X is a/an/the Y" -- the determiner is kept inside the detail so options
    # read as complete phrases rather than bare noun fragments.
    re.compile(
        r"^(?P<s>.{2,60}?)\s+(?:is|are)\s+(?P<d>(?:a|an|the)\s+.{14,})$",
        re.IGNORECASE,
    ),
    # "X is used to/for Y"
    re.compile(r"^(?P<s>.{2,60}?)\s+(?:is|are)\s+used\s+(?:to|for|as)\s+(?P<d>.+)$", re.IGNORECASE),
    # "X means/refers to Y"
    re.compile(r"^(?P<s>.{2,60}?)\s+(?:means|refers to)\s+(?P<d>.{15,})$", re.IGNORECASE),
]

# Cause/effect uses distinctive markers, so a lazy subject is safe here.
# Deliberately excludes ambiguous verbs such as "gives"/"produces", which would
# otherwise mis-split ordinary "subject verb object" sentences.
CAUSE_PATTERN = re.compile(
    r"^(?P<s>.{2,60}?)\s+(?:causes?|leads? to|results? in|contributes? to|"
    r"is responsible for|results? from|brings? about)\s+(?P<d>.{15,})$",
    re.IGNORECASE,
)

# Verbs that look like predicates but carry no teachable relationship.
NON_PREDICATE_VERBS = {
    "is", "are", "was", "were", "has", "have", "had", "does", "do", "did",
    "seems", "appears", "belongs", "consists", "includes", "uses", "requires",
    "means", "refers", "exists", "remains", "becomes", "comes", "goes", "gets",
}

# Words that end in -s/-es but are never the predicate of a study statement.
NON_PREDICATE_WORDS = NON_PREDICATE_VERBS | {
    "across", "among", "between", "through", "during", "within", "without",
    "over", "under", "upon", "onto", "into", "from", "with", "about",
    "after", "before", "since", "until", "while", "when", "where", "per",
    "via", "than", "this", "thus", "its", "his", "her", "their", "our",
    "less", "always", "also", "thus", "yes", "less", "plus", "versus",
    "networks", "services", "systems", "users", "hosts", "applications",
}

# Third-person singular verbs common in study material. When one of these is
# present it is a much more reliable predicate than a bare -s word.
STUDY_VERBS = {
    "transmits", "provides", "routes", "divides", "maps", "inverts", "outputs",
    "stores", "translates", "forwards", "determines", "depends", "uses",
    "performs", "contains", "carries", "handles", "supports", "requires",
    "allows", "needs", "forms", "controls", "operates", "represents",
    "describes", "indicates", "converts", "transmits", "detects", "amplifies",
    "manages", "applies", "ensures", "addresses", "aligns", "responds",
    "encapsulates", "fragments", "reassembles", "compresses", "encrypts",
    "authenticates", "authorises", "resolves", "caches", "queues", "schedules",
    "multiplexes", "demultiplexes", "terminates", "establishes", "maintains",
    "monitors", "filters", "prioritises", "balances", "isolates", "proxies",
    "bridges", "tunnels", "negotiates", "acknowledges", "acknowledgements",
}

# Generic fallback for the very common "Subject verb-s object" study sentence:
# "The NOT gate inverts its single input signal."
#
# Handled by :func:`_generic_predicate` rather than a single regex: both lazy and
# greedy subject quantifiers mis-split compounds like
# "Network address translation maps private addresses ...".

# Words that make a poor question subject or a meaningless detail.
BAD_SUBJECT = re.compile(
    r"^(?:it|this|that|these|those|they|we|you|there|here|one|such|example|figure|table|note|"
    r"question|problem|item|answer|option|step|part|section|chapter|page|explanation|note)\b",
    re.IGNORECASE,
)
BAD_DETAIL = re.compile(
    r"\b(?:see|refer to|as (?:shown|mentioned)|above|below|the following|etc|figure|table)\b",
    re.IGNORECASE,
)

MIN_SUBJECT_WORDS = 1
MAX_SUBJECT_WORDS = 8


def _clean_subject(raw: str) -> str | None:
    subject = raw.strip(" .,:;-")
    subject = re.sub(r"^(?:a|an|the)\s+", "", subject, flags=re.IGNORECASE).strip()
    if BAD_SUBJECT.match(subject):
        return None
    words = subject.split()
    if not (MIN_SUBJECT_WORDS <= len(words) <= MAX_SUBJECT_WORDS):
        return None
    # A subject should be a noun phrase, not a whole clause.
    if len(subject) > 55 or "," in subject or subject.lower().startswith(("if ", "when ", "while ")):
        return None
    return subject


def _clean_detail(raw: str) -> str | None:
    detail = raw.strip(" .,:;-").strip()
    if len(detail) < 15:
        return None
    if BAD_DETAIL.search(detail):
        return None
    words = detail.split()
    if len(words) < 4 or len(words) > 30:
        return None
    # Reject fragments that are mostly punctuation/citations.
    if sum(char.isalpha() for char in detail) < len(detail) * 0.6:
        return None
    return detail


def _generic_predicate(sentence: str) -> tuple[str, str, str] | None:
    """Find the verb in a "Subject verb-s object" sentence.

    A recognised study verb wins outright. Otherwise fall back to a right-to-left
    scan that skips prepositions and trailing nouns, which would otherwise be
    mistaken for the predicate ("...transmits raw bits across a medium" ->
    verb "across").
    """
    words = sentence.split()
    if len(words) < 5:
        return None

    def build(index: int) -> tuple[str, str, str] | None:
        subject = " ".join(words[:index]).strip()
        detail = " ".join(words[index + 1 :]).strip()
        if len(detail) < 15 or len(subject.split()) > 7:
            return None
        return subject, detail, "property"

    # 1. Prefer an explicitly known study verb.
    for index in range(3, len(words) - 1):
        if words[index].lower().strip(".,;:") in STUDY_VERBS:
            candidate = build(index)
            if candidate:
                return candidate

    # 2. Fallback: scan from the right, skipping words that cannot be verbs.
    for index in range(len(words) - 1, 3, -1):
        verb = words[index].lower().strip(".,;:")
        if len(verb) < 4 or not verb.endswith(("s", "es")):
            continue
        if verb in NON_PREDICATE_WORDS:
            continue

        candidate = build(index)
        if candidate:
            return candidate

    return None


def _match(sentence: str) -> tuple[str, str, str] | None:
    for pattern in DEFINITION_PATTERNS:
        found = pattern.match(sentence)
        if found:
            return found.group("s"), found.group("d"), "definition"

    found = CAUSE_PATTERN.match(sentence)
    if found:
        return found.group("s"), found.group("d"), "cause"

    # Generic "subject verb-s object" fallback so ordinary study sentences such
    # as "The NOT gate inverts its single input signal." are still usable.
    return _generic_predicate(sentence)


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", text or "")
    return [part.strip() for part in parts if part and part.strip()]


def extract_facts(lines: Iterable[Line]) -> list[Fact]:
    """Recover teachable statements from cleaned lines."""
    facts: list[Fact] = []
    seen: set[str] = set()

    for line in lines:
        for sentence in split_sentences(line.text):
            if len(sentence) < 30 or len(sentence) > 300:
                continue

            matched = _match(sentence)
            if matched is None:
                continue

            subject = _clean_subject(matched[0])
            detail = _clean_detail(matched[1])
            if not subject or not detail:
                continue

            fact = Fact(
                subject=subject,
                detail=detail,
                kind=matched[2],
                pages=[line.page],
                excerpt=sentence.rstrip("."),
                raw_subject=matched[0].strip().rstrip(" .,:;-" ),
            )
            if fact.fingerprint in seen:
                continue
            seen.add(fact.fingerprint)
            facts.append(fact)

    return facts


def similar(first: str, second: str, threshold: float = 0.8) -> bool:
    """True when two strings share enough tokens to be near-duplicates."""
    left = set(normalize(first).split())
    right = set(normalize(second).split())
    if not left or not right:
        return False
    overlap = len(left & right)
    union = len(left | right)
    return union > 0 and (overlap / union) >= threshold