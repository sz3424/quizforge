import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useApi, describeApiError } from '@/hooks/useApiError';
import { QuizConfig } from '@/components/quiz/QuizConfig';
import type { Document, DocumentPage, Quiz } from '@/types';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { AxiosProgressEvent } from 'axios';

type Step = 'upload' | 'preview' | 'configure';

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload PDF' },
  { key: 'preview', label: 'Review text' },
  { key: 'configure', label: 'Configure quiz' },
];

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const CreateQuiz: React.FC = () => {
  const navigate = useNavigate();
  const api = useApi();
  const { success, error } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentData, setDocumentData] = useState<Document | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSearch, setPageSearch] = useState('');
  const [loadingPages, setLoadingPages] = useState(false);

  const validateFile = (file: File): string | null => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) return 'Only PDF files are accepted.';
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`;
    }
    if (file.size === 0) return 'That file is empty.';
    return null;
  };

  const acceptFile = (file: File) => {
    const message = validateFile(file);
    if (message) {
      setValidationError(message);
      setSelectedFile(null);
      return;
    }
    setValidationError(null);
    setSelectedFile(file);
  };

  const uploadDocument = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadPercent(0);
    setValidationError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await api.post<Document>('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event: AxiosProgressEvent) => {
          if (event.total) {
            setUploadPercent(Math.round((event.loaded / event.total) * 100));
          }
        },
      });

      setDocumentData(response.data);
      setStep('preview');
      success('PDF processed', `${response.data.page_count ?? 0} page(s) extracted.`);
    } catch (err) {
      console.error('Upload failed:', err);
      setValidationError(describeApiError(err));
    } finally {
      setUploading(false);
      setUploadPercent(null);
    }
  };

  const loadPage = useCallback(
    async (pageNumber: number) => {
      if (!documentData) return;
      setLoadingPages(true);
      try {
        const response = await api.get<DocumentPage>(
          `/documents/${documentData.id}/pages/${pageNumber}`
        );
        setPages((prev) => {
          const next = prev.filter((page) => page.page_number !== pageNumber);
          return [...next, response.data].sort((a, b) => a.page_number - b.page_number);
        });
      } catch (err) {
        console.error('Failed to load page:', err);
        error('Could not load page', describeApiError(err));
      } finally {
        setLoadingPages(false);
      }
    },
    [api, documentData, error]
  );

  useEffect(() => {
    if (step === 'preview' && documentData && currentPage <= (documentData.page_count ?? 1)) {
      void loadPage(currentPage);
    }
  }, [step, documentData, currentPage, loadPage]);

  const currentPageText = useMemo(
    () => pages.find((page) => page.page_number === currentPage)?.text ?? '',
    [pages, currentPage]
  );

  const filteredPageText = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    if (!query) return currentPageText;
    if (!currentPageText.toLowerCase().includes(query)) return '';
    const index = currentPageText.toLowerCase().indexOf(query);
    const start = Math.max(0, index - 120);
    return `…${currentPageText.slice(start, index + query.length + 120)}…`;
  }, [currentPageText, pageSearch]);

  const resetAll = () => {
    setStep('upload');
    setSelectedFile(null);
    setDocumentData(null);
    setPages([]);
    setCurrentPage(1);
    setPageSearch('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeDocument = async () => {
    if (!documentData) {
      resetAll();
      return;
    }
    if (!window.confirm('Remove this document and its extracted text? Any quizzes made from it are kept.')) {
      return;
    }
    try {
      await api.delete(`/documents/${documentData.id}`);
      success('Document removed');
    } catch (err) {
      console.error('Failed to delete document:', err);
      error('Could not remove document', describeApiError(err));
    }
    resetAll();
  };

  const handleQuizCreated = (quiz: Quiz) => {
    navigate(`/quizzes/${quiz.id}/review`);
  };

  const currentStepIndex = STEP_LABELS.findIndex((item) => item.key === step);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Quiz</h1>
          <p className="mt-1 text-sm text-content-muted">Upload study material, review the extracted text, then generate questions.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/quizzes')}>
          My Quizzes
        </Button>
      </header>

      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Progress">
        {STEP_LABELS.map((item, index) => {
          const isCurrent = item.key === step;
          const isDone = index < currentStepIndex;
          return (
            <li key={item.key} className="flex items-center gap-2">
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={
                  isCurrent
                    ? 'rounded-md bg-accent px-2.5 py-1 font-medium text-primary'
                    : isDone
                      ? 'text-content-secondary'
                      : 'text-content-muted'
                }
              >
                {index + 1}. {item.label}
              </span>
              {index < STEP_LABELS.length - 1 && <ArrowRight className="h-3 w-3 text-content-muted" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {step === 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle>Upload your study material</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a PDF file"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) acceptFile(file);
              }}
              className={
                'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors duration-150 ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
                (isDragging ? 'border-primary bg-accent/50' : 'border-border hover:border-primary/60')
              }
            >
              <UploadCloud className="h-9 w-9 text-content-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">Drag and drop a PDF here, or browse files.</p>
              <p className="mt-1 text-xs text-content-muted">PDF only · maximum 25 MB</p>
              <p className="mt-3 max-w-md text-xs text-content-muted">
                Files are stored locally on this machine. When question generation is configured with a remote AI
                provider, the extracted text of the pages used for generation is sent to that provider.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) acceptFile(file);
              }}
            />

            {selectedFile && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-content-muted">{(selectedFile.size / 1024).toFixed(1)} KB · ready to upload</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  Remove
                </Button>
              </div>
            )}

            {validationError && (
              <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {validationError}
              </div>
            )}

            {uploading && (
              <div className="space-y-2" role="status" aria-live="polite">
                <Progress value={uploadPercent ?? 0} />
                <p className="flex items-center justify-center gap-2 text-xs text-content-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {uploadPercent === null
                    ? 'Uploading and extracting text…'
                    : `Uploading… ${uploadPercent}% (extraction starts after the upload finishes)`}
                </p>
              </div>
            )}

            <Button onClick={() => void uploadDocument()} disabled={!selectedFile || uploading} loading={uploading}>
              Process document
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && documentData && (
        <Card>
          <CardHeader>
            <CardTitle className="truncate">{documentData.original_filename}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{documentData.page_count ?? 0} pages</Badge>
              <Badge variant="outline">
                {documentData.total_words ?? (currentPageText ? currentPageText.split(/\s+/).length : 0)} words on this
                page
              </Badge>
              <Badge variant="outline">Status: {documentData.extraction_status}</Badge>
            </div>

            {documentData.extraction_status !== 'extracted' && (
              <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                This PDF contains little or no selectable text. It is probably a scan or image-only file, and OCR is
                not supported, so questions can't be generated from it.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-2">
                <Label htmlFor="page-search">Search this page</Label>
                <Input
                  id="page-search"
                  placeholder="Find text on the current page…"
                  value={pageSearch}
                  onChange={(event) => setPageSearch(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="text-sm text-content-muted">
                  Page {currentPage} of {documentData.page_count ?? 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((page) => Math.min(documentData.page_count ?? 1, page + 1))
                  }
                  disabled={currentPage >= (documentData.page_count ?? 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="max-h-96 overflow-auto rounded-lg border border-border bg-card p-4">
              {loadingPages ? (
                <p className="flex items-center gap-2 text-sm text-content-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading page text…
                </p>
              ) : filteredPageText ? (
                <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-content-secondary">
                  {filteredPageText}
                </p>
              ) : (
                <p className="text-sm text-content-muted">
                  {pageSearch
                    ? 'No matches on this page.'
                    : 'No selectable text found on this page.'}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button onClick={() => setStep('configure')}>
                Continue to quiz configuration
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="outline" onClick={() => setStep('upload')}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Replace document
              </Button>
              <Button variant="ghost" onClick={() => void removeDocument()} className="sm:ml-auto">
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Remove document
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'configure' && documentData && (
        <QuizConfig document={documentData} onQuizCreated={handleQuizCreated} />
      )}
    </div>
  );
};