import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/hooks/useApi';
import type { Quiz } from '@/types';
import { Download, Library, Loader2, Pencil, PlayCircle, Trash2 } from 'lucide-react';

type SortKey = 'newest' | 'oldest' | 'title' | 'best_score';
type StatusFilter = 'all' | 'never_tried' | 'completed';

const completedAttempts = (quiz: Quiz) =>
  (quiz.attempts ?? []).filter((attempt) => attempt.status === 'completed');

export const MyQuizzes: React.FC = () => {
  const navigate = useNavigate();
  const api = useApi();
  const { success, error } = useToast();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadQuizzes = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await api.get<Quiz[]>('/quizzes');
      setQuizzes(response.data);
    } catch (err) {
      console.error('Failed to load quizzes:', err);
      setLoadError("Couldn't reach the backend. Check that the local server is running and try again.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadQuizzes();
  }, [loadQuizzes]);

  const visibleQuizzes = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = quizzes.filter((quiz) => {
      const matchesQuery =
        query.length === 0 ||
        quiz.title.toLowerCase().includes(query) ||
        (quiz.document?.original_filename ?? '').toLowerCase().includes(query);

      if (!matchesQuery) return false;

      const attempts = completedAttempts(quiz);
      if (statusFilter === 'never_tried') return attempts.length === 0;
      if (statusFilter === 'completed') return attempts.length > 0;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        case 'best_score': {
          const bestA = Math.max(0, ...completedAttempts(a).map((att) => att.percentage ?? 0));
          const bestB = Math.max(0, ...completedAttempts(b).map((att) => att.percentage ?? 0));
          return bestB - bestA;
        }
        case 'newest':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return sorted;
  }, [quizzes, search, statusFilter, sortKey]);

  const handleDelete = async (quiz: Quiz) => {
    const attemptCount = quiz.attempts?.length ?? 0;
    const message =
      attemptCount > 0
        ? `Delete "${quiz.title}"? This will also permanently delete ${attemptCount} recorded attempt(s) and their results. This cannot be undone.`
        : `Delete "${quiz.title}"? This cannot be undone.`;

    if (!window.confirm(message)) return;

    setBusyId(quiz.id);
    try {
      await api.delete(`/quizzes/${quiz.id}`);
      setQuizzes((prev) => prev.filter((item) => item.id !== quiz.id));
      success('Quiz deleted', `"${quiz.title}" was removed.`);
    } catch (err) {
      console.error('Failed to delete quiz:', err);
      error('Could not delete quiz', 'The quiz may still have attempts recorded against it.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (quiz: Quiz) => {
    const title = renameValue.trim();
    if (!title) {
      error('Title required', 'Enter a name for this quiz.');
      return;
    }
    if (title.length > 120) {
      error('Title too long', 'Quiz titles are limited to 120 characters.');
      return;
    }

    setBusyId(quiz.id);
    try {
      await api.patch(`/quizzes/${quiz.id}`, { title });
      setQuizzes((prev) => prev.map((item) => (item.id === quiz.id ? { ...item, title } : item)));
      setRenamingId(null);
      success('Quiz renamed');
    } catch (err) {
      console.error('Failed to rename quiz:', err);
      error('Could not rename quiz');
    } finally {
      setBusyId(null);
    }
  };

  const handleExport = async (quiz: Quiz, includeAnswers: boolean) => {
    setBusyId(quiz.id);
    try {
      const response = await api.get(`/quizzes/${quiz.id}/export`, {
        params: { include_answers: includeAnswers },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `quizforge-${quiz.id}${includeAnswers ? '-with-answers' : ''}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      success('Export ready', 'The quiz file was downloaded.');
    } catch (err) {
      console.error('Failed to export quiz:', err);
      error('Export failed', 'The quiz could not be exported.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading quizzes…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Quizzes</h1>
          <p className="mt-1 text-sm text-content-muted">Search, review and export the quizzes you have created.</p>
        </div>
        <Button onClick={() => navigate('/create')}>
          <Library className="mr-2 h-4 w-4" aria-hidden="true" />
          Create new quiz
        </Button>
      </header>

      {loadError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}{' '}
          <button type="button" onClick={() => void loadQuizzes()} className="underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center">
          <div className="flex-1">
            <label htmlFor="quiz-search" className="sr-only">
              Search quizzes
            </label>
            <Input
              id="quiz-search"
              placeholder="Search by quiz or document name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="md:w-48" aria-label="Filter by attempt status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All quizzes</SelectItem>
              <SelectItem value="never_tried">Never attempted</SelectItem>
              <SelectItem value="completed">Completed at least once</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
            <SelectTrigger className="md:w-48" aria-label="Sort quizzes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="title">Title A–Z</SelectItem>
              <SelectItem value="best_score">Highest best score</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {visibleQuizzes.length} {visibleQuizzes.length === 1 ? 'quiz' : 'quizzes'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleQuizzes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <Library className="mx-auto h-8 w-8 text-content-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">You haven't created a quiz yet.</p>
              <p className="mt-1 text-sm text-content-muted">Upload a PDF to get started.</p>
              <Button className="mt-4" onClick={() => navigate('/create')}>
                Upload your first PDF
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Source document</TableHead>
                  <TableHead>Questions</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Best score</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleQuizzes.map((quiz) => {
                  const attempts = completedAttempts(quiz);
                  const best = attempts.length ? Math.max(...attempts.map((att) => att.percentage ?? 0)) : null;
                  const isRenaming = renamingId === quiz.id;
                  const isBusy = busyId === quiz.id;

                  return (
                    <TableRow key={quiz.id}>
                      <TableCell className="font-medium">
                        {isRenaming ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={renameValue}
                              autoFocus
                              maxLength={120}
                              aria-label={`New title for ${quiz.title}`}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void handleRename(quiz);
                                if (event.key === 'Escape') setRenamingId(null);
                              }}
                            />
                            <Button size="sm" disabled={isBusy} onClick={() => void handleRename(quiz)}>
                              Save
                            </Button>
                          </div>
                        ) : (
                          quiz.title
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-content-muted">
                        {quiz.document?.original_filename ?? '—'}
                      </TableCell>
                      <TableCell>{quiz.question_count ?? quiz.questions?.length ?? 0}</TableCell>
                      <TableCell>
                        {quiz.difficulty ? (
                          <Badge variant="secondary" className="text-xs">
                            {quiz.difficulty}
                          </Badge>
                        ) : (
                          <span className="text-xs text-content-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell>{quiz.attempts?.length ?? 0}</TableCell>
                      <TableCell>
                        {best === null ? (
                          <span className="text-xs text-content-muted">Not attempted</span>
                        ) : (
                          <Badge variant={best >= 70 ? 'default' : 'secondary'} className="text-xs">
                            {Math.round(best)}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/quizzes/${quiz.id}/review`)}>
                            Review
                          </Button>
                          <Button size="sm" onClick={() => navigate(`/quiz/${quiz.id}`)}>
                            <PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                            Take
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Rename ${quiz.title}`}
                            onClick={() => {
                              setRenamingId(quiz.id);
                              setRenameValue(quiz.title);
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Export ${quiz.title} as JSON`}
                            disabled={isBusy}
                            onClick={() => void handleExport(quiz, false)}
                          >
                            <Download className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${quiz.title}`}
                            disabled={isBusy}
                            onClick={() => void handleDelete(quiz)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};