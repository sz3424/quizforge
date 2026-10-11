"""PDF upload, extraction and document management."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

import fitz
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import Document, DocumentPage, Quiz
from app.schemas import serialize_document, serialize_document_page

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = Path(settings.upload_dir).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = settings.max_file_size_mb * 1024 * 1024

MAGIC = b"%PDF-"


def _storage_path(internal_filename: str) -> Path:
    """Resolve an internal filename, refusing anything outside the upload dir."""
    candidate = (UPLOAD_DIR / internal_filename).resolve()
    if candidate.parent != UPLOAD_DIR:
        raise HTTPException(status_code=400, detail="Invalid storage path.")
    return candidate


def _normalize_text(raw: str) -> str:
    """Collapse runs of spaces/tabs but keep paragraph breaks."""
    if not raw:
        return ""
    text = raw.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    if file.content_type not in ("application/pdf", "application/x-pdf", "application/octet-stream"):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only PDF files are accepted.")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only .pdf files are accepted.")

    payload = await file.read()
    if len(payload) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is larger than the {settings.max_file_size_mb} MB limit.",
        )
    if not payload.startswith(MAGIC):
        raise HTTPException(status_code=400, detail="That file is not a readable PDF.")
    if not payload.strip():
        raise HTTPException(status_code=400, detail="That file is empty.")

    internal_filename = f"{uuid.uuid4().hex}.pdf"
    path = _storage_path(internal_filename)
    path.write_bytes(payload)

    try:
        document = fitz.open(path)
    except Exception:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="This PDF is corrupted and could not be opened.")

    try:
        if document.needs_pass:
            raise HTTPException(status_code=400, detail="This PDF is password protected.")

        page_count = document.page_count
        if page_count == 0:
            raise HTTPException(status_code=400, detail="This PDF has no pages.")
        if page_count > settings.max_pages:
            raise HTTPException(
                status_code=400,
                detail=f"This PDF has {page_count} pages, above the {settings.max_pages} page limit.",
            )

        page_texts = [_normalize_text(document.load_page(index).get_text()) for index in range(page_count)]
    except HTTPException:
        document.close()
        path.unlink(missing_ok=True)
        raise
    except Exception:
        document.close()
        path.unlink(missing_ok=True)
        logger.exception("Text extraction failed")
        raise HTTPException(status_code=400, detail="Text could not be extracted from this PDF.")
    finally:
        document.close()

    extracted_characters = sum(len(text) for text in page_texts)

    record = Document(
        original_filename=Path(file.filename).name,
        internal_filename=internal_filename,
        file_size=len(payload),
        page_count=page_count,
        extraction_status="extracted" if extracted_characters > 0 else "no_text",
    )
    db.add(record)
    db.flush()

    for number, text in enumerate(page_texts, start=1):
        db.add(DocumentPage(document_id=record.id, page_number=number, text=text))

    db.commit()
    db.refresh(record)

    if extracted_characters == 0:
        logger.info("Document %s uploaded with no selectable text", record.id)

    return serialize_document(record, [DocumentPage(document_id=record.id, page_number=i + 1, text=t) for i, t in enumerate(page_texts)])


@router.get("")
def list_documents(db: Session = Depends(get_db)) -> list[dict]:
    documents = db.scalars(select(Document).order_by(Document.created_at.desc())).all()
    return [serialize_document(document) for document in documents]


@router.get("/{document_id}")
def get_document(document_id: int, db: Session = Depends(get_db)) -> dict:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="This document could not be found. It may have been deleted.")
    return serialize_document(document)


@router.get("/{document_id}/pages/{page_number}")
def get_document_page(document_id: int, page_number: int, db: Session = Depends(get_db)) -> dict:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="This document could not be found. It may have been deleted.")

    page = db.scalar(
        select(DocumentPage).where(
            DocumentPage.document_id == document_id, DocumentPage.page_number == page_number
        )
    )
    if not page:
        raise HTTPException(status_code=404, detail=f"Page {page_number} does not exist in this document.")
    return serialize_document_page(page)


@router.delete("/{document_id}")
def delete_document(document_id: int, db: Session = Depends(get_db)) -> JSONResponse:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="This document could not be found. It may have been deleted.")

    linked_quizzes = db.scalars(select(Quiz.id).where(Quiz.document_id == document_id)).all()

    if linked_quizzes:
        raise HTTPException(
            status_code=409,
            detail="This document still has quizzes attached. Delete those quizzes first.",
        )

    db.query(DocumentPage).filter(DocumentPage.document_id == document_id).delete()
    db.delete(document)
    db.commit()

    _storage_path(document.internal_filename).unlink(missing_ok=True)
    return JSONResponse({"message": "Document deleted."})