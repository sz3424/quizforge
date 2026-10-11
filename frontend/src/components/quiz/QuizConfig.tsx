import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { useApi, describeApiError } from '@/hooks/useApiError';
import type { Document, Difficulty, QuestionType, Quiz } from '@/types';
import { Loader2 } from 'lucide-react';

interface QuizConfigProps {
  document: Document;
  onQuizCreated: (quiz: Quiz) => void;
}

const QUESTION_TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / false' },
  { value: 'short_answer', label: 'Short answer' },
];

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy — definitions and direct facts' },
  { value: 'medium', label: 'Medium — concepts and applications' },
  { value: 'hard', label: 'Hard — multi-step reasoning' },
  { value: 'mixed', label: 'Mixed — spread across levels' },
];

const COUNT_OPTIONS = [5, 10, 15, 20];

const titleFromFilename = (filename: string): string => {
  const base = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  return `${base} — Revision Quiz`.slice(0, 120);
};

export const QuizConfig: React.FC<QuizConfigProps> = ({ document, onQuizCreated }) => {
  const navigate = useNavigate();
  const api = useApi();
  const { success, error } = useToast();

  const [title, setTitle] = useState(() => titleFromFilename(document.original_filename));
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>(['multiple_choice', 'true_false']);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [showExplanations, setShowExplanations] = useState(true);
  const [showSourcePages, setShowSourcePages] = useState(true);
  const [allowRetry, setAllowRetry] = useState(true);
  const [allowSkip, setAllowSkip] = useState(true);
  const [generating, setGenerating] = useState(false);

  const toggleType = (type: QuestionType) => {
    setQuestionTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((item) => item !== type);
        return next.length > 0 ? next : prev;
      }
      return [...prev, type];
    });
  };

  const handleGenerate = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      error('Title required', 'Give the quiz a short title before generating.');
      return;
    }
    if (trimmedTitle.length > 120) {
      error('Title too long', 'Quiz titles are limited to 120 characters.');
      return;
    }
    if (questionTypes.length === 0) {
      error('Select a question type', 'Choose at least one question type.');
      return;
    }

    setGenerating(true);
    try {
      const response = await api.post<Quiz>('/quizzes/generate', {
        title: trimmedTitle,
        document_id: document.id,
        difficulty,
        config: {
          question_count: questionCount,
          question_types: questionTypes,
          shuffle_questions: shuffleQuestions,
          shuffle_options: shuffleOptions,
          show_explanations: showExplanations,
          show_source_pages: showSourcePages,
          allow_retry: allowRetry,
          allow_skip: allowSkip,
        },
      });

      const created = response.data;
      success(
        'Quiz generated',
        created.generation_method === 'offline'
          ? 'Questions were created with the offline generator.'
          : 'Questions were created with the configured AI provider.'
      );
      onQuizCreated(created);
    } catch (err) {
      console.error('Quiz generation failed:', err);
      error('Generation failed', describeApiError(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Quiz configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="quiz-title">Quiz title</Label>
            <Input
              id="quiz-title"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              aria-describedby="quiz-title-hint"
            />
            <p id="quiz-title-hint" className="text-xs text-content-muted">
              {title.trim().length}/120 characters
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="question-count">Number of questions</Label>
            <Select
              value={String(questionCount)}
              onValueChange={(value) => setQuestionCount(Number(value))}
            >
              <SelectTrigger id="question-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNT_OPTIONS.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count} questions
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-content-muted">
              Based on {document.page_count ?? '?'} page(s) of extracted text, {questionCount} is a reasonable target.
              Generation may return fewer questions if the document doesn't contain enough distinct facts.
            </p>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Question types</legend>
            <div className="flex flex-wrap gap-4">
              {QUESTION_TYPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`type-${option.value}`}
                    checked={questionTypes.includes(option.value)}
                    onCheckedChange={() => toggleType(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="difficulty">Difficulty</Label>
            <Select value={difficulty} onValueChange={(value) => setDifficulty(value as Difficulty)}>
              <SelectTrigger id="difficulty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Answer and review behaviour</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showExplanations} onCheckedChange={setShowExplanations} />
            Show explanations after submitting the quiz
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showSourcePages} onCheckedChange={setShowSourcePages} />
            Show source page references when available
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shuffleQuestions} onCheckedChange={setShuffleQuestions} />
            Shuffle question order
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shuffleOptions} onCheckedChange={setShuffleOptions} />
            Shuffle answer options
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allowSkip} onCheckedChange={setAllowSkip} />
            Allow skipping questions
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allowRetry} onCheckedChange={setAllowRetry} />
            Allow retaking the quiz
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => void handleGenerate()} loading={generating} className="sm:flex-1">
          {!generating && 'Generate quiz'}
        </Button>
        <Button variant="outline" onClick={() => navigate(-1)} disabled={generating}>
          Back to document
        </Button>
      </div>

      {generating && (
        <p role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm text-content-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Generating questions from your document…
        </p>
      )}
    </div>
  );
};