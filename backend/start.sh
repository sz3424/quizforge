#!/usr/bin/env bash
# Start the QuizForge API on a PaaS host (Render, Railway, Fly, Heroku).
#
# Binds 0.0.0.0 and honours the PORT the platform injects. Platforms that run a
# Procfile do not execute this file.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8000}"

# On most hosts the app directory is read-only and only $TMPDIR is writable.
# Fall back to a temp directory so startup does not crash on mkdir.
if [ -z "${UPLOAD_DIR:-}" ]; then
  if mkdir -p ./storage/uploads 2>/dev/null; then
    export UPLOAD_DIR="./storage/uploads"
  else
    export UPLOAD_DIR="${TMPDIR:-/tmp}/quizforge/uploads"
    mkdir -p "$UPLOAD_DIR"
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  mkdir -p "$(dirname "$UPLOAD_DIR")" 2>/dev/null || true
  export DATABASE_URL="sqlite:///${TMPDIR:-/tmp}/quizforge/quizforge.db"
fi

echo "Starting QuizForge API on 0.0.0.0:${PORT}"
echo "  UPLOAD_DIR   = ${UPLOAD_DIR}"
echo "  DATABASE_URL = ${DATABASE_URL}"

exec uvicorn main:app --host 0.0.0.0 --port "${PORT}" --proxy-headers