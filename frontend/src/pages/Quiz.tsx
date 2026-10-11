import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { useApi, describeApiError } from '@/hooks/useApiError';
import type { Attempt, Question, Quiz as QuizRecord } from '@/types';
import { cn } from '@/utils/cn';
import { AlertCircle, Check, Clock, Flag, Loader2, Send } from 'lucide-react';

type Answers = Record<number, string>;

const TRUE_FALSE_OPTIONS = [
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
];

export const QuizPlayer: React.FC = () => {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { error } = useToast();

  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const quizResponse = await api.get<QuizRecord>(`/quizzes/${quizId}`);
        const questions: Question[] = quizResponse.data.questions ?? [];

        if (questions.length === 0) {
          setLoadError('This quiz has no questions yet. Add questions in the review screen first.');
          return;
        }

        const attemptResponse = await api.post<Attempt>(`/quizzes/${quizId}/attempts`, {});

        if (cancelled) return;
        setQuiz({ ...quizResponse.data, questions });
        setAttempt(attemptResponse.data);
      } catch (err) {
        console.error('Failed to start quiz:', err);
        if (!cancelled) {
          setLoadError(describeApiError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [api, quizId]);

  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);

  const answeredCount = useMemo(
    () => Object.values(answers).filter((value) => value.trim().length > 0).length,
    [answers]
  );
  const flaggedCount = useMemo(() => Object.values(flagged).filter(Boolean).length, [flagged]);
  const unansweredCount = Math.max(questions.length - answeredCount, 0);
  const totalQuestions = questions.length;
  const progress = totalQuestions === 0 ? 0 : Math.round((answeredCount / totalQuestions) * 100);
  const currentQuestion = questions[currentIndex];

  const setAnswer = useCallback((questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!attempt || submitting) return;
    setSubmitting(true);
    try {
      await api.put(`/quizzes/${quizId}/attempts/${attempt.id}/answers`, {
        answers: Object.entries(answers).map(([questionId, answer]) => ({
          question_id: Number(questionId),
          answer,
        })),
      });
      const submitResponse = await api.post<Attempt>(`/quizzes/${quizId}/attempts/${attempt.id}/submit`, {});
      navigate(`/results/${submitResponse.data.id}`, { replace: true });
    } catch (err) {
      console.error('Failed to submit quiz:', err);
      error('Could not submit quiz', 'Your answers were kept. Try submitting again.');
      setSubmitting(false);
    }
  }, [answers, attempt, api, error, navigate, quizId, submitting]);

  // Keyboard shortcuts: arrows to move, 1-4 to pick an MCQ option.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (submitting || !currentQuestion) return;
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((index) => Math.max(index - 1, 0));
      } else if (currentQuestion.type === 'multiple_choice' && /^[1-9]$/.test(event.key)) {
        const option = currentQuestion.options?.[Number(event.key) - 1];
        if (option !== undefined) {
          event.preventDefault();
          setAnswer(currentQuestion.id, option);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentQuestion, setAnswer, submitting, totalQuestions]);

  const handleExit = () => {
    const confirmed = window.confirm(
      'Leave this attempt? Your answers so far stay saved on this attempt, and you can finish it later from My Quizzes.'
    );
    if (confirmed) navigate(`/quizzes`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading quiz…
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
        <p className="mt-3 text-sm text-destructive">{loadError}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/quizzes')}>
            Back to My Quizzes
          </Button>
          {quiz && (
            <Button variant="outline" onClick={() => navigate(`/quizzes/${quiz.id}/review`)}>
              Open quiz review
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!quiz || !currentQuestion) return null;

  const isSelected = (value: string) => answers[currentQuestion.id] === value;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{quiz.title}</h1>
          {quiz.document?.original_filename && (
            <p className="mt-1 truncate text-sm text-content-muted">{quiz.document.original_filename}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleExit}>
          Exit
        </Button>
      </header>

      <section aria-label="Quiz progress" className="space-y-2">
        <div className="flex flex-wrap justify-between gap-x-4 text-sm text-content-muted">
          <span>
            Question {currentIndex + 1} of {totalQuestions}
          </span>
          <span>
            {answeredCount} answered · {unansweredCount} unanswered
            {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ''}
          </span>
        </div>
        <Progress value={progress} />
        <p className="text-xs text-content-muted">
          Keyboard: ← → to move between questions{currentQuestion.type === 'multiple_choice' ? ', number keys to pick an option' : ''}.
        </p>
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Question {currentIndex + 1}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {currentQuestion.type.replace('_', ' ')}
              </Badge>
              {currentQuestion.difficulty && (
                <Badge variant="secondary" className="text-xs">
                  {currentQuestion.difficulty}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-medium leading-relaxed">{currentQuestion.text}</p>
          {currentQuestion.source_pages && currentQuestion.source_pages.length > 0 && (
            <p className="mt-2 text-xs text-content-muted">Source: page {currentQuestion.source_pages.join(', ')}</p>
          )}

          <div className="mt-5">
            {currentQuestion.type === 'multiple_choice' && (
              <fieldset>
                <legend className="sr-only">Answer options</legend>
                <div className="space-y-2">
                  {currentQuestion.options?.map((option, index) => {
                    const selected = isSelected(option);
                    return (
                      <label
                        key={`${currentQuestion.id}-${index}`}
                        className={cn(
                          'answer-option answer-option-interactive',
                          selected && 'answer-option-selected'
                        )}
                      >
                        <input
                          type="radio"
                          name={`question-${currentQuestion.id}`}
                          className="sr-only"
                          checked={selected}
                          onChange={() => setAnswer(currentQuestion.id, option)}
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-content-muted'
                          )}
                        >
                          {selected ? <Check className="h-3 w-3" /> : index + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-content-primary">{option}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {currentQuestion.type === 'true_false' && (
              <fieldset>
                <legend className="sr-only">True or false</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {TRUE_FALSE_OPTIONS.map((option) => {
                    const selected = isSelected(option.value);
                    return (
                      <label
                        key={option.value}
                        className={cn(
                          'answer-option answer-option-interactive',
                          selected && 'answer-option-selected'
                        )}
                      >
                        <input
                          type="radio"
                          name={`question-${currentQuestion.id}`}
                          className="sr-only"
                          checked={selected}
                          onChange={() => setAnswer(currentQuestion.id, option.value)}
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-content-muted'
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1 text-content-primary">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {currentQuestion.type === 'short_answer' && (
              <div>
                <label htmlFor={`short-answer-${currentQuestion.id}`} className="sr-only">
                  Your answer
                </label>
                <Textarea
                  id={`short-answer-${currentQuestion.id}`}
                  placeholder="Type your answer…"
                  maxLength={500}
                  value={answers[currentQuestion.id] ?? ''}
                  onChange={(event) => setAnswer(currentQuestion.id, event.target.value)}
                />
                <p className="mt-1 text-xs text-content-muted">
                  Short answers are marked by exact/normalized text matching.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Question navigator */}
      <nav aria-label="Question navigator" className="rounded-lg border border-border p-3">
        <ul className="flex flex-wrap gap-2">
          {questions.map((question, index) => {
            const answered = (answers[question.id] ?? '').trim().length > 0;
            const isFlagged = Boolean(flagged[question.id]);
            const isCurrent = index === currentIndex;
            return (
              <li key={question.id}>
                <button
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={`Question ${index + 1}: ${answered ? 'answered' : 'unanswered'}${
                    isFlagged ? ', flagged for review' : ''
                  }`}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isCurrent
                      ? 'border-primary bg-primary text-primary-foreground'
                      : answered
                        ? 'border-success/50 bg-accent text-foreground'
                        : 'border-border text-content-muted hover:bg-accent/60'
                  )}
                >
                  {index + 1}
                  {isFlagged && <Flag className="ml-0.5 h-3 w-3 text-warning" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
            disabled={currentIndex === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            onClick={() => setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1))}
            disabled={currentIndex === totalQuestions - 1}
          >
            Next
          </Button>
          <Button
            variant={flagged[currentQuestion.id] ? 'default' : 'outline'}
            onClick={() =>
              setFlagged((prev) => ({ ...prev, [currentQuestion.id]: !prev[currentQuestion.id] }))
            }
          >
            <Flag className="mr-2 h-4 w-4" aria-hidden="true" />
            {flagged[currentQuestion.id] ? 'Flagged' : 'Mark for review'}
          </Button>
          {answers[currentQuestion.id] && (
            <Button variant="ghost" onClick={() => setAnswer(currentQuestion.id, '')}>
              Clear answer
            </Button>
          )}
        </div>

        <Button onClick={() => void handleSubmit()} loading={submitting}>
          {!submitting && <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
          Submit quiz
        </Button>
      </div>

      <p className="flex items-center gap-2 text-xs text-content-muted">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        Unanswered questions are marked incorrect. You can review every answer after submitting.
      </p>
    </div>
  );
};