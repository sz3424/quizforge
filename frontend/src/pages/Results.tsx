import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { useToast } from '@/components/ui/Toast';
import { useApi, describeApiError } from '@/hooks/useApiError';
import type { AttemptResults, Question } from '@/types';
import { AlertCircle, CheckCircle2, Download, Loader2, MinusCircle, RotateCcw } from 'lucide-react';

const statusMeta = {
  correct: { label: 'Correct', className: 'text-success', Icon: CheckCircle2 },
  incorrect: { label: 'Incorrect', className: 'text-destructive', Icon: AlertCircle },
  unanswered: { label: 'Unanswered', className: 'text-content-muted', Icon: MinusCircle },
} as const;

const formatDuration = (seconds?: number | null) => {
  if (seconds === undefined || seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

const renderCorrectAnswer = (question: Question): string => {
  if (question.type === 'true_false') {
    return question.correct_answer === 'true' ? 'True' : 'False';
  }
  return question.correct_answer ?? '—';
};

export const Results: React.FC = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { success, error } = useToast();

  const [results, setResults] = useState<AttemptResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await api.get<AttemptResults>(`/attempts/${attemptId}/results`);
      setResults(response.data);
    } catch (err) {
      console.error('Failed to load results:', err);
      setLoadError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [api, attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(true);
    try {
      const response = await api.get(`/attempts/${attemptId}/export`, {
        params: { format },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `quizforge-results-${attemptId}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      success('Export ready', `Your results were downloaded as ${format.toUpperCase()}.`);
    } catch (err) {
      console.error('Failed to export results:', err);
      error('Export failed', describeApiError(err));
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading results…
      </div>
    );
  }

  if (loadError || !results) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
        <p className="mt-3 text-sm text-destructive">
          {loadError ?? 'This result could not be found. It may have been deleted with its quiz.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/history')}>
          Back to History
        </Button>
      </div>
    );
  }

  const { attempt, quiz, questions, correct_count, incorrect_count, unanswered_count } = results;
  const percentage = attempt.percentage ?? 0;
  const total = questions.length || 1;

  const rows = questions.map((question) => {
    const answer = results.answers.find((item) => item.question_id === question.id);
    const submitted = (answer?.submitted_answer ?? '').trim();
    if (!answer || submitted.length === 0) {
      return { question, answer, status: 'unanswered' as const };
    }
    return {
      question,
      answer,
      status: answer.correctness ? ('correct' as const) : ('incorrect' as const),
    };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Quiz complete</h1>
        <p className="text-sm text-content-muted">{quiz.title}</p>
        <p className="text-5xl font-bold tracking-tight text-primary">{percentage.toFixed(1)}%</p>
        <p className="text-sm text-content-muted">
          {attempt.score ?? 0} of {attempt.max_score ?? 0} marks ·{' '}
          {new Date(attempt.submitted_at ?? attempt.started_at).toLocaleString()} ·{' '}
          {formatDuration(attempt.duration_seconds)}
        </p>
      </header>

      <section aria-label="Score breakdown" className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-xs uppercase tracking-wide text-content-muted">Correct</p>
            <p className="mt-1 text-2xl font-bold text-success">{correct_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-xs uppercase tracking-wide text-content-muted">Incorrect</p>
            <p className="mt-1 text-2xl font-bold text-destructive">{incorrect_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-xs uppercase tracking-wide text-content-muted">Unanswered</p>
            <p className="mt-1 text-2xl font-bold text-content-muted">{unanswered_count}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-content-muted">Answer distribution</span>
            <span className="text-content-muted">
              {correct_count} / {total}
            </span>
          </div>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full" aria-hidden="true">
            <span className="bg-success" style={{ width: `${(correct_count / total) * 100}%` }} />
            <span className="bg-destructive" style={{ width: `${(incorrect_count / total) * 100}%` }} />
            <span className="bg-muted" style={{ width: `${(unanswered_count / total) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-content-muted">
            Short answers are graded by exact or normalized text matching, so short-answer results are approximate.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Answer review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map(({ question, answer, status }, index) => {
            const meta = statusMeta[status];
            const StatusIcon = meta.Icon;
            return (
              <article key={question.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-medium">
                    {index + 1}. {question.text}
                  </h3>
                  <Badge variant="outline" className={meta.className}>
                    <StatusIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                    {meta.label}
                  </Badge>
                </div>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-content-muted">Your answer</dt>
                    <dd className={answer?.submitted_answer ? 'text-content-primary' : 'text-content-muted'}>
                      {answer?.submitted_answer || 'Not answered'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-content-muted">Correct answer</dt>
                    <dd className="text-content-primary">{renderCorrectAnswer(question)}</dd>
                  </div>
                </dl>

                {question.type === 'multiple_choice' && question.options && question.options.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {question.options.map((option, optionIndex) => {
                      const isKey = option === question.correct_answer;
                      const isChosen = option === answer?.submitted_answer;
                      const state = isKey
                        ? 'answer-option answer-option-correct'
                        : isChosen
                          ? 'answer-option answer-option-incorrect'
                          : 'answer-option';

                      return (
                        <li key={optionIndex} className={state}>
                          <span
                            aria-hidden="true"
                            className={
                              isKey
                                ? 'answer-option-badge mt-0.5 bg-success text-success-foreground'
                                : isChosen
                                  ? 'answer-option-badge mt-0.5 bg-destructive text-destructive-foreground'
                                  : 'answer-option-badge mt-0.5 border border-border text-content-muted'
                            }
                          >
                            {optionIndex + 1}
                          </span>
                          <span className="min-w-0 flex-1 text-content-primary">{option}</span>
                          {isKey && (
                            <span className="answer-option-badge shrink-0 bg-success text-success-foreground">
                              Correct
                            </span>
                          )}
                          {isChosen && !isKey && (
                            <span className="answer-option-badge shrink-0 bg-destructive text-destructive-foreground">
                              Your pick
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {question.explanation && (
                  <div className="explanation-block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                      Explanation
                    </span>
                    {question.explanation}
                  </div>
                )}
                {quiz.config?.show_source_pages !== false && question.source_pages && question.source_pages.length > 0 && (
                  <p className="mt-2 text-xs text-content-muted">Source: page {question.source_pages.join(', ')}</p>
                )}
              </article>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate('/')}>Back to Dashboard</Button>
        <Button variant="outline" onClick={() => navigate(`/quiz/${quiz.id}`)}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Retake full quiz
        </Button>
        <Button variant="outline" onClick={() => navigate('/history')}>
          View history
        </Button>
        <Button variant="ghost" onClick={() => void handleExport('json')} disabled={exporting}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Export JSON
        </Button>
        <Button variant="ghost" onClick={() => void handleExport('csv')} disabled={exporting}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      <Progress value={percentage} className="sr-only" />
    </div>
  );
};