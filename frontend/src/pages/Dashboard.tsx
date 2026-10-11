import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useApi, describeApiError } from '@/hooks/useApiError';
import type { Attempt, Quiz } from '@/types';
import { AlertCircle, ArrowRight, FilePlus2, Library, Loader2 } from 'lucide-react';

const round1 = (value: number) => Math.round(value * 10) / 10;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const api = useApi();

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [attemptsResponse, quizzesResponse] = await Promise.all([
        api.get<Attempt[]>('/attempts'),
        api.get<Quiz[]>('/quizzes'),
      ]);
      setAttempts(attemptsResponse.data);
      setQuizzes(quizzesResponse.data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setLoadError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const completedAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.status === 'completed'),
    [attempts]
  );

  const stats = useMemo(() => {
    const total = completedAttempts.length;
    const averageScore =
      total === 0
        ? 0
        : round1(
            completedAttempts.reduce((sum, attempt) => sum + (attempt.percentage ?? 0), 0) / total
          );
    const questionsAnswered = completedAttempts.reduce(
      (sum, attempt) => sum + (attempt.answers?.length ?? 0),
      0
    );
    return {
      totalQuizzes: quizzes.length,
      completedAttempts: total,
      averageScore,
      questionsAnswered,
    };
  }, [completedAttempts, quizzes.length]);

  const recentQuizzes = useMemo(
    () =>
      [...quizzes]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5),
    [quizzes]
  );

  const quizById = useMemo(() => new Map(quizzes.map((quiz) => [quiz.id, quiz])), [quizzes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-content-muted">Turn your study material into active recall.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/create')}>
            <FilePlus2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Create a quiz
          </Button>
          <Button variant="outline" onClick={() => navigate('/history')}>
            View history
          </Button>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
          <button type="button" onClick={() => void load()} className="ml-auto underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <Card className="border-primary/30 bg-accent/40">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Your next revision session starts here.</h2>
            <p className="mt-1 text-sm text-content-muted">
              Upload lecture notes or a textbook chapter, then generate a quiz grounded in that exact content.
            </p>
          </div>
          <Button onClick={() => navigate('/create')}>
            Upload your first PDF
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>

      <section aria-label="Statistics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Total quizzes</p>
            <p className="mt-1 text-2xl font-bold">{stats.totalQuizzes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Quizzes completed</p>
            <p className="mt-1 text-2xl font-bold">{stats.completedAttempts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Average score</p>
            <p className="mt-1 text-2xl font-bold">
              {stats.completedAttempts === 0 ? '—' : `${stats.averageScore}%`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Questions answered</p>
            <p className="mt-1 text-2xl font-bold">{stats.questionsAnswered}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent quizzes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentQuizzes.length === 0 ? (
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
                  <TableHead>Created</TableHead>
                  <TableHead>Best score</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentQuizzes.map((quiz) => {
                  const best = Math.max(
                    0,
                    ...(quiz.attempts ?? [])
                      .filter((attempt) => attempt.status === 'completed')
                      .map((attempt) => attempt.percentage ?? 0)
                  );
                  const hasAttempts = (quiz.attempts ?? []).some(
                    (attempt) => attempt.status === 'completed'
                  );

                  return (
                    <TableRow key={quiz.id}>
                      <TableCell className="font-medium">{quiz.title}</TableCell>
                      <TableCell className="text-sm text-content-muted">
                        {quiz.document?.original_filename ?? '—'}
                      </TableCell>
                      <TableCell>{quiz.question_count ?? quiz.questions?.length ?? 0}</TableCell>
                      <TableCell className="text-sm text-content-muted">
                        {new Date(quiz.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {hasAttempts ? (
                          <Badge variant={best >= 70 ? 'default' : 'secondary'} className="text-xs">
                            {Math.round(best)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-content-muted">Not attempted</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/quizzes/${quiz.id}/review`)}
                          >
                            Review
                          </Button>
                          <Button size="sm" onClick={() => navigate(`/quiz/${quiz.id}`)}>
                            Take quiz
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

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {completedAttempts.length === 0 && quizzes.length === 0 ? (
            <p className="text-sm text-content-muted">
              Nothing here yet. Uploads, quiz creation and completed attempts appear here as you use QuizForge.
            </p>
          ) : (
            <ol className="space-y-2">
              {[...completedAttempts]
                .sort(
                  (a, b) =>
                    new Date(b.submitted_at ?? b.started_at).getTime() -
                    new Date(a.started_at).getTime()
                )
                .slice(0, 5)
                .map((attempt) => (
                  <li key={`attempt-${attempt.id}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-content-secondary">
                      Completed{' '}
                      <span className="font-medium text-foreground">
                        {quizById.get(attempt.quiz_id)?.title ?? `Quiz #${attempt.quiz_id}`}
                      </span>
                    </span>
                    <span className="text-xs text-content-muted">
                      {new Date(attempt.submitted_at ?? attempt.started_at).toLocaleString()}
                    </span>
                  </li>
                ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-content-muted">
            <Link to="/history" className="text-primary underline underline-offset-2">
              View full history
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};