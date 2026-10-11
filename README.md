# QUIZFORGE

A local-first PDF quiz maker. Upload a PDF, extract its real text, generate questions grounded in that text, take the quiz, review your answers with explanations, and track your performance. Everything is stored on your own machine in SQLite.

---

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | Developed and tested on 3.14 |
| Node.js | 18+ | Developed and tested on Node 20 |

---

## Setup (Windows PowerShell)

### 1. Backend

```powershell
cd quizforge\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

The database file and upload folder are created automatically on first start, so there is no separate migration step.

Start the API:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

You should see:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

Interactive API docs: <http://127.0.0.1:8000/docs>

### 2. Frontend

```powershell
cd quizforge\frontend
npm install
```

Create your local config (this file is git-ignored and holds no secrets):

```powershell
Copy-Item .env.example .env
```

Start Vite:

```powershell
npm run dev
```

You should see:

```
VITE v5.x  ready in NNN ms
Local:   http://localhost:5173/
```

Open <http://localhost:5173>.

### Optional: start both at once

```powershell
.\start-dev.ps1
```

This checks for Python and Node, creates the virtual environment if needed, installs dependencies, and opens both servers in separate windows. It never overwrites an existing `.env`, database, or uploaded document.

---

## Configuring AI question generation

QuizForge works **without** any AI provider. When none is configured, the backend generates questions with a clearly labelled **offline extraction generator** and stores `generation_method: "offline"` so the UI never claims AI produced them.

To enable LLM generation, copy `backend\.env.example` to `backend\.env` and set:

```
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o
# Optional, for any OpenAI-compatible gateway:
OPENAI_API_BASE=https://api.openai.com/v1
```

Restart the backend afterwards. The Settings page reads the provider status from `GET /api/settings/provider` and tells you which variables are missing. **API keys are only ever read from backend environment variables — they are never sent to the browser and cannot be edited from the UI.**

> When an AI provider is configured, the extracted text of the pages used for generation is sent to that provider. When it is not, your document text never leaves the machine.

---

## Verifying your install

Run the backend end-to-end suite (uses a throwaway database and temp folder, never your data):

```powershell
cd quizforge\backend
.\venv\Scripts\python.exe -m tests.test_api
```

Expected output:

```
PASSED: 54   FAILED: 0
All backend smoke tests passed.
```

Build and lint the frontend:

```powershell
cd quizforge\frontend
npm run build
npm run lint
```

---

## Project layout

```
quizforge/
├── backend/
│   ├── main.py                 FastAPI app, routers, error handling
│   ├── app/
│   │   ├── api/
│   │   │   ├── health.py       GET /api/health
│   │   │   ├── documents.py    upload, extraction, page text
│   │   │   ├── quizzes.py      generate, list, edit, export
│   │   │   ├── attempts.py     attempts, answers, results, exports
│   │   │   └── settings.py     provider status, data export/clear
│   │   ├── core/config.py      env-driven settings
│   │   ├── db.py               engine + schema init
│   │   ├── models.py           SQLAlchemy models
│   │   ├── requests.py         request validation
│   │   ├── schemas.py          response serializers
│   │   └── services/
│   │       ├── question_generation.py  LLM + offline generators
│   │       ├── grading.py              answer grading
│   │       └── export.py               JSON/CSV export builders
│   └── tests/test_api.py       end-to-end smoke test
├── frontend/
│   └── src/
│       ├── components/ui/      reusable primitives
│       ├── components/layout/  sidebar + app shell
│       ├── components/quiz/    quiz configuration
│       ├── hooks/              api, theme, health
│       ├── pages/              Dashboard, CreateQuiz, QuizReview,
│       │                       Quiz, Results, MyQuizzes, History,
│       │                       Analytics, Settings
│       └── types/              shared TypeScript types
└── storage/                    SQLite DB + uploaded PDFs (git-ignored)
```

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness + database check |
| GET | `/api/settings` | Limits and provider status |
| GET | `/api/settings/provider` | Provider configuration (never the key) |
| POST | `/api/documents/upload` | Upload + extract a PDF |
| GET | `/api/documents` | List documents |
| GET | `/api/documents/{id}` | Document metadata |
| GET | `/api/documents/{id}/pages/{n}` | Extracted text for one page |
| DELETE | `/api/documents/{id}` | Delete a document |
| POST | `/api/quizzes/generate` | Generate a quiz from a document |
| GET | `/api/quizzes` | List quizzes |
| GET | `/api/quizzes/{id}` | Quiz with questions |
| PATCH | `/api/quizzes/{id}` | Rename / reconfigure |
| PUT | `/api/quizzes/{id}/questions` | Replace question set |
| DELETE | `/api/quizzes/{id}` | Delete quiz and its attempts |
| GET | `/api/quizzes/{id}/export` | Export quiz JSON |
| POST | `/api/quizzes/{id}/attempts` | Start an attempt |
| PUT | `/api/quizzes/{id}/attempts/{aid}/answers` | Save answers |
| POST | `/api/quizzes/{id}/attempts/{aid}/submit` | Submit and grade |
| GET | `/api/attempts` | All attempts |
| GET | `/api/attempts/{id}` | One attempt with answers |
| GET | `/api/attempts/{id}/results` | Graded result breakdown |
| GET | `/api/attempts/{id}/export` | Export results (`?format=json\|csv`) |
| GET | `/api/data/export` | Export everything |
| DELETE | `/api/data` | Clear all local data |

---

## Troubleshooting

**"Couldn't reach the backend"** — the API is not running or is on another port. Start it and confirm <http://127.0.0.1:8000/api/health> returns `{"status":"healthy"}`. The sidebar indicator reflects the real result of that poll.

**Frontend shows `CORS` errors** — the origin is not allowed. Add it to `CORS_ORIGINS` in `backend/.env` as a comma-separated list, then restart the backend.

**"We couldn't extract readable text"** — the PDF is scanned or image-only. QuizForge does not perform OCR, and it says so rather than pretending to read the file.

**Generation returns 422** — the document did not yield enough sentence-like text to build questions. The error names the reason; try a text-based PDF.

**`ExecutionPolicy` blocks `Activate.ps1`** — either run the commands with the venv's Python directly (`.\venv\Scripts\python.exe ...`) or, in PowerShell, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

**Port already in use** — change the `--port` flag for the backend, or set `VITE_API_BASE` in `frontend/.env` to match.