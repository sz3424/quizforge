import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { useApi } from '@/hooks/useApi';
import type { Attempt, Quiz } from '@/types';
import { cn } from '@/utils/cn';
import { AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, Loader2, Minus } from 'lucide-react';

type TrendPoint = { submittedAt: string; percentage: number };

type TypeBreakdown = {
  multiple_choice: { correct: number; total: number };
  true_false: { correct: number; total: number };
  short_answer: { correct: number; total: number };
};

const TYPE_LABELS: Record<keyof TypeBreakdown, string> = {
  multiple_choice: 'Multiple choice',
  true_false: 'True / false',
  short_answer: 'Short answer',
};

const round1 = (value: number) => Math.round(value * 10) / 10;

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-content-muted">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export const Analytics: React.FC = () => {
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
      console.error('Failed to load analytics:', err);
      setLoadError("Couldn't reach the backend. Check that the local server is running and try again.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const completedAttempts = useMemo(
    () =>
      attempts
        .filter((attempt) => attempt.status === 'completed' && typeof attempt.percentage === 'number')
        .sort((a, b) => new Date(a.submitted_at ?? a.started_at).getTime() - new Date(b.submitted_at ?? b.started_at).getTime()),
    [attempts]
  );

  const totalAttempts = completedAttempts.length;
  const totalQuizzes = quizzes.length;
  const averageScore = useMemo(
    () =>
      totalAttempts === 0
        ? 0
        : round1(
            completedAttempts.reduce((sum, attempt) => sum + (attempt.percentage ?? 0), 0) / totalAttempts
          ),
    [completedAttempts, totalAttempts]
  );
  const bestScore = useMemo(
    () => (totalAttempts === 0 ? 0 : Math.max(...completedAttempts.map((attempt) => attempt.percentage ?? 0))),
    [completedAttempts, totalAttempts]
  );
  const questionsAnswered = useMemo(
    () => completedAttempts.reduce((sum, attempt) => sum + (attempt.answers?.length ?? 0), 0),
    [completedAttempts]
  );

  const trend: TrendPoint[] = useMemo(
    () =>
      completedAttempts
        .slice(-10)
        .map((attempt) => ({
          submittedAt: attempt.submitted_at ?? attempt.started_at,
          percentage: attempt.percentage ?? 0,
        })),
    [completedAttempts]
  );

  /** Only computed from data the backend actually returned. */
  const typeBreakdown = useMemo<TypeBreakdown>(() => {
    const breakdown: TypeBreakdown = {
      multiple_choice: { correct: 0, total: 0 },
      true_false: { correct: 0, total: 0 },
      short_answer: { correct: 0, total: 0 },
    };

    for (const attempt of completedAttempts) {
      for (const answer of attempt.answers ?? []) {
        if (!answer.question_type) continue;
        const bucket = breakdown[answer.question_type as keyof TypeBreakdown];
        if (!bucket) continue;
        bucket.total += 1;
        if (answer.correctness) bucket.correct += 1;
      }
    }

    return breakdown;
  }, [completedAttempts]);

  const insights = useMemo(() => {
    const messages: string[] = [];
    if (totalAttempts === 0) return messages;

    if (trend.length >= 2) {
      const previous = trend[trend.length - 2];
      const latest = trend[trend.length - 1];
      const delta = round1(latest.percentage - previous.percentage);
      if (delta > 0) {
        messages.push(`Your latest attempt scored ${delta} percentage points higher than the one before it.`);
      } else if (delta < 0) {
        messages.push(`Your latest attempt scored ${Math.abs(delta)} percentage points lower than the one before it.`);
      } else {
        messages.push('Your last two attempts scored the same percentage.');
      }
    }

    const medium = Object.entries(typeBreakdown).filter(([, bucket]) => bucket.total > 0);
    for (const [key, bucket] of medium) {
      messages.push(`You answered ${bucket.correct} of ${bucket.total} ${TYPE_LABELS[key as keyof TypeBreakdown].toLowerCase()} questions correctly.`);
    }

    if (bestScore === 100 && totalAttempts > 0) {
      messages.push('You have recorded a perfect score. Try a harder difficulty to keep challenging yourself.');
    }

    return messages;
  }, [bestScore, totalAttempts, trend, typeBreakdown]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-content-muted">Every number below comes from your saved attempts.</p>
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

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Completed attempts" value={String(totalAttempts)} />
        <SummaryCard label="Average score" value={`${averageScore}%`} />
        <SummaryCard label="Best score" value={`${Math.round(bestScore)}%`} />
        <SummaryCard label="Questions answered" value={String(questionsAnswered)} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Score trend</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
              <BarChart3 className="mx-auto h-7 w-7 text-content-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">No completed attempts yet.</p>
              <p className="mt-1 text-sm text-content-muted">
                The trend appears once you submit your first quiz.{' '}
                <Link to="/quizzes" className="text-primary underline underline-offset-2">
                  Take a quiz
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <ol className="space-y-2">
                {trend.map((point, index) => {
                  const previous = index > 0 ? trend[index - 1] : null;
                  const delta = previous ? round1(point.percentage - previous.percentage) : null;
                  return (
                    <li key={point.submittedAt + index} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <span className="text-sm text-content-muted">{new Date(point.submittedAt).toLocaleString()}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-32 sm:w-48">
                          <Progress value={Math.max(0, Math.min(100, point.percentage))} className="h-2" />
                        </div>
                        <span className="w-14 text-right text-sm font-medium">{point.percentage.toFixed(1)}%</span>
                        <span className="flex w-6 justify-center" aria-hidden="true">
                          {delta === null ? (
                            <Minus className="h-4 w-4 text-content-muted" />
                          ) : delta > 0 ? (
                            <ArrowUpRight className="h-4 w-4 text-success" />
                          ) : delta < 0 ? (
                            <ArrowDownRight className="h-4 w-4 text-destructive" />
                          ) : (
                            <Minus className="h-4 w-4 text-content-muted" />
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-content-muted">
                Showing the last {trend.length} completed {trend.length === 1 ? 'attempt' : 'attempts'}.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance by question type</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {(Object.keys(TYPE_LABELS) as (keyof TypeBreakdown)[]).map((key) => {
              const bucket = typeBreakdown[key];
              const percentage = bucket.total === 0 ? 0 : Math.round((bucket.correct / bucket.total) * 100);
              return (
                <li key={key}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{TYPE_LABELS[key]}</span>
                    {bucket.total === 0 ? (
                      <span className="text-xs text-content-muted">No attempts</span>
                    ) : (
                      <Badge variant={percentage >= 70 ? 'default' : 'secondary'} className="text-xs">
                        {percentage}% ({bucket.correct}/{bucket.total})
                      </Badge>
                    )}
                  </div>
                  <Progress value={percentage} className={cn('mt-2', 'h-2')} />
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-content-muted">
            Short answers are graded by exact/normalized text matching, so treat that row as approximate.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Study insights</CardTitle>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-content-muted">
              Insights appear after you complete a quiz. Nothing is inferred before then.
            </p>
          ) : (
            <ul className="space-y-2">
              {insights.map((message) => (
                <li key={message} className="flex items-start gap-2 text-sm text-content-secondary">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {message}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-content-muted">
        {totalQuizzes} {totalQuizzes === 1 ? 'quiz' : 'quizzes'} saved. Quizzes are listed in{' '}
        <Link to="/quizzes" className="text-primary underline underline-offset-2">
          My Quizzes
        </Link>
        .
      </p>
    </div>
  );
};