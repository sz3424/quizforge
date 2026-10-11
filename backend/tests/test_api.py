"""End-to-end smoke test for the QuizForge backend.

Runs against a throwaway SQLite database and a temporary upload directory, so it
never touches the user's real data.

Run with:
    .\\venv\\Scripts\\python.exe -m tests.test_api
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Point the app at an isolated database/storage before importing anything.
_TMP = Path(tempfile.mkdtemp(prefix="quizforge-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["UPLOAD_DIR"] = str(_TMP / "uploads")
# Ensure the provider is treated as unconfigured so the offline path is used.
os.environ.pop("OPENAI_API_KEY", None)

import fitz  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

PASSED: list[str] = []
FAILED: list[str] = []

PDF_PATH = _TMP / "sample.pdf"


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label} :: {detail}")


def build_pdf(path: Path) -> None:
    """Create a small text-based PDF with several factual sentences."""
    lines = [
        "Digital Electronics Fundamentals",
        "",
        "The binary number system uses only two digits, zero and one.",
        "A logic gate performs a basic logical operation on binary inputs.",
        "The NOT gate inverts its single input signal.",
        "The AND gate outputs a high signal only when all inputs are high.",
        "An XOR gate outputs high when an odd number of inputs are high.",
        "A flip-flop stores one bit of binary data between clock cycles.",
        "Combinational logic circuits depend only on their current inputs.",
        "Sequential logic circuits depend on present and past outputs.",
        "Clock synchronisation aligns circuit timing across components.",
        "Voltage thresholds determine whether a signal reads as high or low.",
    ]

    document = fitz.open()
    page = document.new_page()
    text = "BT /F1 11 Tf 14 TL 56 760 Td\n"
    for line in lines:
        escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        text += f"({escaped}) Tj T*\n"
    text += "ET"
    page.insert_textbox(fitz.Rect(50, 50, 560, 790), "\n".join(lines), fontsize=11)
    document.save(path)
    document.close()


def main() -> int:
    build_pdf(PDF_PATH)

    # Using the context manager triggers the app startup event (schema creation).
    with TestClient(app) as client:
        return run_checks(client)


def run_checks(client) -> int:
    print("\n[1] Health")
    response = client.get("/api/health")
    check("GET /api/health returns 200", response.status_code == 200, response.text)
    check("health reports healthy", response.json().get("status") == "healthy", response.text)

    print("\n[2] Provider status")
    response = client.get("/api/settings/provider")
    check("provider endpoint returns 200", response.status_code == 200, response.text)
    body = response.json()
    check("provider reports not configured without API key", body["configured"] is False, str(body))
    check("provider never leaks a key", "api_key" not in body, str(body))

    print("\n[3] Upload validation")
    response = client.post("/api/documents/upload", files={"file": ("notes.txt", b"plain text", "text/plain")})
    check("rejects non-PDF content type with 415", response.status_code == 415, response.text)

    response = client.post(
        "/api/documents/upload", files={"file": ("fake.pdf", b"not really a pdf", "application/pdf")}
    )
    check("rejects fake PDF magic bytes", response.status_code == 400, response.text)

    print("\n[4] Upload a real PDF")
    with PDF_PATH.open("rb") as handle:
        response = client.post("/api/documents/upload", files={"file": ("sample.pdf", handle, "application/pdf")})
    check("upload returns 201", response.status_code == 201, response.text)
    document = response.json()
    document_id = document["id"]
    check("page count detected", (document.get("page_count") or 0) >= 1, str(document))
    check("extraction status is extracted", document.get("extraction_status") == "extracted", str(document))

    response = client.get(f"/api/documents/{document_id}/pages/1")
    check("page text is readable", response.status_code == 200 and len(response.json()["text"]) > 50, response.text)

    print("\n[5] Quiz generation (offline, no AI provider configured)")
    response = client.post(
        "/api/quizzes/generate",
        json={
            "title": "Digital Electronics — Revision Quiz",
            "document_id": document_id,
            "difficulty": "medium",
            "config": {"question_count": 5, "question_types": ["multiple_choice", "true_false", "short_answer"]},
        },
    )
    check("generate returns 201", response.status_code == 201, response.text)
    quiz = response.json()
    quiz_id = quiz["id"]
    questions = quiz["questions"]
    check("questions were generated", len(questions) >= 3, str(len(questions)))
    check("generation method is labelled offline", quiz["generation_method"] == "offline", str(quiz["generation_method"]))
    check("provider label is stored", bool(quiz["config"].get("provider_label")), str(quiz["config"]))
    check("questions have source pages", all(q["source_pages"] for q in questions), str(questions[:1]))
    check(
        "multiple choice questions have options",
        all(q["options"] for q in questions if q["type"] == "multiple_choice"),
        str(questions[:1]),
    )

    print("\n[6] Validation of generated payloads")
    response = client.post(
        "/api/quizzes/generate",
        json={"title": "Bad", "document_id": document_id, "config": {"question_count": 999}},
    )
    check("out-of-range question_count rejected with 422", response.status_code == 422, response.text)

    response = client.post("/api/quizzes/generate", json={"title": "   ", "document_id": document_id})
    check("blank title rejected with 422", response.status_code == 422, response.text)

    print("\n[7] Library + persistence")
    response = client.get("/api/quizzes")
    check("quiz list returns the saved quiz", any(q["id"] == quiz_id for q in response.json()), response.text)

    print("\n[8] Question editing")
    edited = [
        {
            "id": questions[0]["id"],
            "text": questions[0]["text"],
            "type": questions[0]["type"],
            "options": questions[0]["options"],
            "correct_answer": questions[0]["correct_answer"],
            "explanation": "Edited explanation",
            "source_pages": questions[0]["source_pages"],
            "order": 0,
        }
    ]
    response = client.put(f"/api/quizzes/{quiz_id}/questions", json={"questions": edited})
    check("replace questions returns 200", response.status_code == 200, response.text)
    check("explanation edit persisted", response.json()["questions"][0]["explanation"] == "Edited explanation", response.text)

    bad_edit = [{"id": None, "text": "Pick one", "type": "multiple_choice", "options": ["A"], "correct_answer": "A"}]
    response = client.put(f"/api/quizzes/{quiz_id}/questions", json={"questions": bad_edit})
    check("single-option MCQ rejected with 422", response.status_code == 422, response.text)

    print("\n[9] Rename + export")
    response = client.patch(f"/api/quizzes/{quiz_id}", json={"title": "Renamed Quiz"})
    check("rename returns 200", response.status_code == 200, response.text)
    check("rename applied", response.json()["title"] == "Renamed Quiz", response.text)

    response = client.get(f"/api/quizzes/{quiz_id}/export", params={"include_answers": True})
    check("quiz export returns 200", response.status_code == 200, response.text)
    check("export includes answers", response.json()["includes_answers"] is True, response.text)

    print("\n[10] Attempt lifecycle + grading")
    response = client.post(f"/api/quizzes/{quiz_id}/attempts")
    check("start attempt returns 201", response.status_code == 201, response.text)
    attempt_id = response.json()["id"]

    detail = client.get(f"/api/quizzes/{quiz_id}").json()
    questions = detail["questions"]

    payload_answers = []
    for index, question in enumerate(questions):
        if question["type"] == "multiple_choice":
            payload_answers.append({"question_id": question["id"], "answer": question["correct_answer"]})
        elif question["type"] == "true_false":
            payload_answers.append({"question_id": question["id"], "answer": question["correct_answer"]})
        else:
            # Deliberately wrong on some to prove partial grading.
            payload_answers.append({"question_id": question["id"], "answer": "definitely wrong answer"})

    # Leave one question unanswered.
    payload_answers = payload_answers[:-1]

    response = client.put(
        f"/api/quizzes/{quiz_id}/attempts/{attempt_id}/answers", json={"answers": payload_answers}
    )
    check("save answers returns 200", response.status_code == 200, response.text)

    response = client.put(
        f"/api/quizzes/{quiz_id}/attempts/{attempt_id}/answers",
        json={"answers": [{"question_id": -1, "answer": "x"}]},
    )
    check("answer for unknown question rejected with 422", response.status_code == 422, response.text)

    response = client.post(f"/api/quizzes/{quiz_id}/attempts/{attempt_id}/submit")
    check("submit returns 200", response.status_code == 200, response.text)
    submitted = response.json()
    check("status becomes completed", submitted["status"] == "completed", response.text)
    check("score is numeric", isinstance(submitted["score"], (int, float)), response.text)

    response = client.post(f"/api/quizzes/{quiz_id}/attempts/{attempt_id}/submit")
    check("duplicate submission rejected with 409", response.status_code == 409, response.text)

    print("\n[11] Results")
    response = client.get(f"/api/attempts/{attempt_id}/results")
    check("results return 200", response.status_code == 200, response.text)
    results = response.json()
    correct = results["correct_count"]
    incorrect = results["incorrect_count"]
    unanswered = results["unanswered_count"]
    check(
        "counts add up to the question total",
        correct + incorrect + unanswered == len(results["questions"]),
        f"{correct}+{incorrect}+{unanswered} vs {len(results['questions'])}",
    )
    check("at least one unanswered detected", unanswered >= 1, response.text)

    response = client.get("/api/attempts")
    check("attempt list returns 200", response.status_code == 200, response.text)
    check("attempt list includes our attempt", any(a["id"] == attempt_id for a in response.json()), response.text)

    print("\n[12] Result exports")
    response = client.get(f"/api/attempts/{attempt_id}/export", params={"format": "json"})
    check("json export returns 200", response.status_code == 200, response.text)
    check("json export has answers", len(response.json()["answers"]) == len(results["questions"]), response.text)

    response = client.get(f"/api/attempts/{attempt_id}/export", params={"format": "csv"})
    check("csv export returns 200", response.status_code == 200, response.text)
    check("csv export has content-type", "text/csv" in response.headers.get("content-type", ""), response.headers)

    print("\n[13] 404 handling")
    check("missing quiz returns 404", client.get("/api/quizzes/99999").status_code == 404)
    check("missing document returns 404", client.get("/api/documents/99999").status_code == 404)
    check("missing attempt returns 404", client.get("/api/attempts/99999").status_code == 404)

    print("\n[14] Editing a quiz with completed history is blocked")
    response = client.put(
        f"/api/quizzes/{quiz_id}/questions",
        json={"questions": [{"id": None, "text": "Should not be allowed", "type": "short_answer", "correct_answer": "x"}]},
    )
    check("edit blocked with 409 after completed attempt", response.status_code == 409, response.text)

    print("\n[15] Delete cascade")
    response = client.delete(f"/api/quizzes/{quiz_id}")
    check("quiz delete returns 200", response.status_code == 200, response.text)
    check("quiz is gone", client.get(f"/api/quizzes/{quiz_id}").status_code == 404)

    response = client.get("/api/attempts")
    check("attempts removed with quiz", not any(a["id"] == attempt_id for a in response.json()), response.text)

    response = client.delete(f"/api/documents/{document_id}")
    check("document delete returns 200", response.status_code == 200, response.text)

    print("\n[16] Data management")
    response = client.get("/api/data/export")
    check("data export returns 200", response.status_code == 200, response.text)
    response = client.delete("/api/data")
    check("clear data returns 200", response.status_code == 200, response.text)
    check("no documents remain", client.get("/api/documents").json() == [], "documents still present")

    print("\n" + "=" * 60)
    print(f"PASSED: {len(PASSED)}   FAILED: {len(FAILED)}")
    if FAILED:
        print("\nFailures:")
        for failure in FAILED:
            print(f"  - {failure}")
        return 1
    print("All backend smoke tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
