import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { useApi, describeApiError } from '@/hooks/useApiError';
import type { Question, QuestionType, Quiz } from '@/types';
import { AlertCircle, ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react';

const emptyQuestion = (order: number): Question => ({
  id: -order - 1,
  text: '',
  type: 'multiple_choice',
  options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
  correct_answer: 'Option 1',
  explanation: '',
  order,
});

export const QuizReview: React.FC = () => {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { success, error } = useToast();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await api.get<Quiz>(`/quizzes/${quizId}`);
      setQuiz(response.data);
      setQuestions(response.data.questions ?? []);
    } catch (err) {
      console.error('Failed to load quiz for review:', err);
      setLoadError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [api, quizId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateQuestion = (index: number, patch: Partial<Question>) => {
    setQuestions((prev) => prev.map((question, i) => (i === index ? { ...question, ...patch } : question)));
  };

  const handleSave = async () => {
    if (!quiz) return;

    for (const [index, question] of questions.entries()) {
      if (!question.text.trim()) {
        error('Question text required', `Question ${index + 1} has no text.`);
        setEditingId(question.id);
        return;
      }
      if (question.type === 'multiple_choice') {
        const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
        if (options.length < 2) {
          error('Not enough options', `Question ${index + 1} needs at least two answer options.`);
          setEditingId(question.id);
          return;
        }
        if (!options.includes((question.correct_answer ?? '').trim())) {
          error('Mark the correct option', `Select which option is correct for question ${index + 1}.`);
          setEditingId(question.id);
          return;
        }
      }
      if (question.type === 'true_false' && !['true', 'false'].includes(question.correct_answer ?? '')) {
        error('Choose true or false', `Question ${index + 1} needs a true or false answer.`);
        setEditingId(question.id);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await api.put<Quiz>(`/quizzes/${quiz.id}/questions`, {
        questions: questions.map((question, index) => ({
          id: question.id > 0 ? question.id : null,
          text: question.text.trim(),
          type: question.type,
          difficulty: question.difficulty ?? null,
          options: question.type === 'multiple_choice' ? question.options : null,
          correct_answer: question.correct_answer,
          explanation: question.explanation ?? null,
          source_pages: question.source_pages ?? null,
          order: index,
        })),
      });

      setQuiz(response.data);
      setQuestions(response.data.questions ?? []);
      setEditingId(null);
      success('Quiz saved', 'Your changes were saved to this quiz.');
    } catch (err) {
      console.error('Failed to save quiz:', err);
      error('Could not save quiz', describeApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = () => {
    const draft = emptyQuestion(questions.length);
    setQuestions((prev) => [...prev, draft]);
    setEditingId(draft.id);
  };

  const handleDeleteQuestion = (index: number) => {
    if (!window.confirm('Remove this question from the quiz? The change is saved when you click Save.')) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
    setEditingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading quiz…
      </div>
    );
  }

  if (loadError || !quiz) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
        <p className="mt-3 text-sm text-destructive">{loadError ?? 'This quiz could not be found. It may have been deleted.'}</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/quizzes')}>
          Back to My Quizzes
        </Button>
      </div>
    );
  }

  const providerLabel =
    quiz.config?.provider_label ??
    (quiz.generation_method === 'offline' ? 'Offline extraction generator' : 'AI provider');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{quiz.title}</h1>
          <p className="mt-1 text-sm text-content-muted">{quiz.document?.original_filename ?? 'Document removed'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/quizzes')}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <Button onClick={() => navigate(`/quiz/${quiz.id}`)}>Start quiz</Button>
        </div>
      </header>

      <section aria-label="Quiz summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-content-muted">Questions</p>
            <p className="mt-1 text-2xl font-bold">{questions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-content-muted">Difficulty</p>
            <p className="mt-1 text-lg font-medium">{quiz.difficulty ?? 'Not set'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-content-muted">Question types</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(quiz.config?.question_types ?? []).length === 0 ? (
                <span className="text-sm text-content-muted">—</span>
              ) : (
                quiz.config?.question_types?.map((type) => (
                  <Badge key={type} variant="secondary" className="text-xs">
                    {type.replace('_', ' ')}
                  </Badge>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-content-muted">Generated by</p>
            <p className="mt-1 text-sm">{providerLabel}</p>
            <p className="mt-1 text-xs text-content-muted">Created {new Date(quiz.created_at).toLocaleDateString()}</p>
          </CardContent>
        </Card>
      </section>

      <div className="space-y-4">
        {questions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">This quiz has no questions.</p>
            <p className="mt-1 text-sm text-content-muted">Add one manually, or regenerate the quiz from the Create screen.</p>
            <Button className="mt-4" onClick={handleAddQuestion}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add question
            </Button>
          </div>
        ) : (
          questions.map((question, index) => {
            const isEditing = editingId === question.id;
            return (
              <Card key={question.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>Question {index + 1}</CardTitle>
                      <Badge variant="outline" className="text-xs">
                        {question.type.replace('_', ' ')}
                      </Badge>
                      {question.difficulty && (
                        <Badge variant="secondary" className="text-xs">
                          {question.difficulty}
                        </Badge>
                      )}
                      {question.source_pages && question.source_pages.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          page {question.source_pages.join(', ')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(isEditing ? null : question.id)}>
                        {isEditing ? 'Close' : 'Edit'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteQuestion(index)}>
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        <span className="sr-only">Delete question {index + 1}</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="grid gap-2">
                        <Label htmlFor={`text-${question.id}`}>Question text</Label>
                        <Textarea
                          id={`text-${question.id}`}
                          value={question.text}
                          onChange={(event) => updateQuestion(index, { text: event.target.value })}
                        />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`type-${question.id}`}>Type</Label>
                          <Select
                            value={question.type}
                            onValueChange={(value) => updateQuestion(index, { type: value as QuestionType })}
                          >
                            <SelectTrigger id={`type-${question.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                              <SelectItem value="true_false">True / false</SelectItem>
                              <SelectItem value="short_answer">Short answer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`difficulty-${question.id}`}>Difficulty</Label>
                          <Select
                            value={question.difficulty ?? 'medium'}
                            onValueChange={(value) => updateQuestion(index, { difficulty: value })}
                          >
                            <SelectTrigger id={`difficulty-${question.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="easy">Easy</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="hard">Hard</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {question.type === 'multiple_choice' && (
                        <fieldset className="grid gap-2">
                          <legend className="text-sm font-medium">Options — tick the correct one</legend>
                          {(question.options ?? []).map((option, optionIndex) => (
                            <div key={optionIndex} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`correct-${question.id}`}
                                aria-label={`Mark option ${optionIndex + 1} as correct`}
                                checked={question.correct_answer === option}
                                onChange={() => updateQuestion(index, { correct_answer: option })}
                                className="h-4 w-4 accent-[rgb(var(--primary))]"
                              />
                              <Input
                                value={option}
                                aria-label={`Option ${optionIndex + 1}`}
                                onChange={(event) => {
                                  const options = [...(question.options ?? [])];
                                  const previous = options[optionIndex];
                                  options[optionIndex] = event.target.value;
                                  updateQuestion(index, {
                                    options,
                                    correct_answer:
                                      question.correct_answer === previous
                                        ? event.target.value
                                        : question.correct_answer,
                                  });
                                }}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Remove option ${optionIndex + 1}`}
                                onClick={() => {
                                  const options = (question.options ?? []).filter((_, i) => i !== optionIndex);
                                  updateQuestion(index, { options, correct_answer: options[0] ?? '' });
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateQuestion(index, { options: [...(question.options ?? []), 'New option'] })
                            }
                          >
                            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                            Add option
                          </Button>
                        </fieldset>
                      )}

                      {question.type === 'true_false' && (
                        <fieldset className="grid gap-2">
                          <legend className="text-sm font-medium">Correct answer</legend>
                          <Select
                            value={question.correct_answer ?? 'true'}
                            onValueChange={(value) => updateQuestion(index, { correct_answer: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">True</SelectItem>
                              <SelectItem value="false">False</SelectItem>
                            </SelectContent>
                          </Select>
                        </fieldset>
                      )}

                      {question.type === 'short_answer' && (
                        <div className="grid gap-2">
                          <Label htmlFor={`answer-${question.id}`}>Expected answer</Label>
                          <Input
                            id={`answer-${question.id}`}
                            value={question.correct_answer ?? ''}
                            onChange={(event) => updateQuestion(index, { correct_answer: event.target.value })}
                          />
                        </div>
                      )}

                      <div className="grid gap-2">
                        <Label htmlFor={`explanation-${question.id}`}>Explanation</Label>
                        <Textarea
                          id={`explanation-${question.id}`}
                          value={question.explanation ?? ''}
                          onChange={(event) => updateQuestion(index, { explanation: event.target.value })}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor={`source-${question.id}`}>Source pages (comma separated)</Label>
                        <Input
                          id={`source-${question.id}`}
                          placeholder="e.g. 3, 4"
                          value={(question.source_pages ?? []).join(', ')}
                          onChange={(event) => {
                            const pages = event.target.value
                              .split(',')
                              .map((part) => Number(part.trim()))
                              .filter((value) => Number.isFinite(value) && value > 0);
                            updateQuestion(index, { source_pages: pages.length ? pages : null });
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">{question.text}</p>
                      {question.type === 'multiple_choice' && (
                        <ul className="mt-3 space-y-2">
                          {(question.options ?? []).map((option, optionIndex) => {
                            const isCorrect = option === question.correct_answer;
                            return (
                              <li
                                key={optionIndex}
                                className={isCorrect ? 'answer-option answer-option-correct' : 'answer-option'}
                              >
                                <span
                                  aria-hidden="true"
                                  className={
                                    isCorrect
                                      ? 'answer-option-badge mt-0.5 bg-success text-success-foreground'
                                      : 'answer-option-badge mt-0.5 border border-border text-content-muted'
                                  }
                                >
                                  {optionIndex + 1}
                                </span>
                                <span className="min-w-0 flex-1 text-content-primary">{option}</span>
                                {isCorrect && (
                                  <span className="answer-option-badge shrink-0 bg-success text-success-foreground">
                                    Correct
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {question.type === 'true_false' && (
                        <p className="mt-2 text-sm text-content-secondary">
                          Answer: <span className="font-medium text-foreground">{question.correct_answer === 'true' ? 'True' : 'False'}</span>
                        </p>
                      )}
                      {question.type === 'short_answer' && (
                        <p className="mt-2 text-sm text-content-secondary">
                          Expected answer: <span className="font-medium text-foreground">{question.correct_answer}</span>
                        </p>
                      )}
                      {question.explanation && (
                        <div className="explanation-block">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                            Explanation
                          </span>
                          {question.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={handleAddQuestion}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add question manually
        </Button>
        <Button onClick={() => void handleSave()} loading={saving} className="sm:flex-1">
          {!saving && <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
          Save changes
        </Button>
      </div>
    </div>
  );
};
