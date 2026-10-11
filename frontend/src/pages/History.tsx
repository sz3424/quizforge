import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useApi } from '@/hooks/useApi';
import type { Attempt, Quiz } from '@/types';
import { AlertCircle, Eye, History as HistoryIcon, Loader2, RefreshCw } from 'lucide-react';

type ScoreFilter = 'all' | 'high' | 'medium' | 'low';
type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';

const formatDuration = (seconds?: number | null) => {
  if (seconds === undefined || seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

export const History: React.FC = () => {
  const navigate = useNavigate();
  const api = useApi();

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

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
      console.error('Failed to load history:', err);
      setLoadError("Couldn't reach the backend. Check that the local server is running and try again.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const quizById = useMemo(() => {
    const map = new Map<number, Quiz>();
    for (const quiz of quizzes) map.set(quiz.id, quiz);
    return map;
  }, [quizzes]);

  const completedAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.status === 'completed'),
    [attempts]
  );

  const visibleAttempts = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = completedAttempts.filter((attempt) => {
      const quiz = quizById.get(attempt.quiz_id);
      const timestamp = attempt.submitted_at ?? attempt.started_at;

      const matchesQuery =
        query.length === 0 ||
        String(attempt.id).includes(query) ||
        (quiz?.title ?? '').toLowerCase().includes(query) ||
        (quiz?.document?.original_filename ?? '').toLowerCase().includes(query) ||
        new Date(timestamp).toLocaleDateString().toLowerCase().includes(query);

      if (!matchesQuery) return false;

      const percentage = attempt.percentage ?? 0;
      if (scoreFilter === 'high') return percentage >= 80;
      if (scoreFilter === 'medium') return percentage >= 50 && percentage < 80;
      if (scoreFilter === 'low') return percentage < 50;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const aTime = new Date(a.submitted_at ?? a.started_at).getTime();
      const bTime = new Date(b.submitted_at ?? b.started_at).getTime();
      switch (sortKey) {
        case 'oldest':
          return aTime - bTime;
        case 'highest':
          return (b.percentage ?? 0) - (a.percentage ?? 0);
        case 'lowest':
          return (a.percentage ?? 0) - (b.percentage ?? 0);
        case 'newest':
        default:
          return bTime - aTime;
      }
    });

    return sorted;
  }, [completedAttempts, quizById, search, scoreFilter, sortKey]);

  const handleRetake = (attempt: Attempt) => {
    if (
      window.confirm(
        'Retake this quiz? A new attempt will be created and your current result stays in History.'
      )
    ) {
      navigate(`/quiz/${attempt.quiz_id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading history…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-content-muted">Completed quiz attempts, newest first by default.</p>
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

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center">
          <div className="flex-1">
            <label htmlFor="history-search" className="sr-only">
              Search attempts
            </label>
            <Input
              id="history-search"
              placeholder="Search by quiz, document or date…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={scoreFilter} onValueChange={(value) => setScoreFilter(value as ScoreFilter)}>
            <SelectTrigger className="md:w-48" aria-label="Filter by score band">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scores</SelectItem>
              <SelectItem value="high">High (80% and above)</SelectItem>
              <SelectItem value="medium">Medium (50–79%)</SelectItem>
              <SelectItem value="low">Low (under 50%)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
            <SelectTrigger className="md:w-48" aria-label="Sort attempts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="highest">Highest score</SelectItem>
              <SelectItem value="lowest">Lowest score</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {visibleAttempts.length} completed {visibleAttempts.length === 1 ? 'attempt' : 'attempts'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleAttempts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <HistoryIcon className="mx-auto h-8 w-8 text-content-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">
                {completedAttempts.length === 0
                  ? 'No completed attempts yet.'
                  : 'No attempts match these filters.'}
              </p>
              <p className="mt-1 text-sm text-content-muted">
                {completedAttempts.length === 0
                  ? 'Finish a quiz and it will appear here with your score and answers.'
                  : 'Try clearing the search box or switching the score filter.'}
              </p>
              {completedAttempts.length === 0 && (
                <Button className="mt-4" onClick={() => navigate('/quizzes')}>
                  Go to My Quizzes
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quiz</TableHead>
                  <TableHead>Source document</TableHead>
                  <TableHead>Attempted</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAttempts.map((attempt) => {
                  const quiz = quizById.get(attempt.quiz_id);
                  const percentage = attempt.percentage ?? 0;
                  const timestamp = attempt.submitted_at ?? attempt.started_at;

                  return (
                    <TableRow key={attempt.id}>
                      <TableCell className="font-medium">{quiz?.title ?? `Quiz #${attempt.quiz_id}`}</TableCell>
                      <TableCell className="text-sm text-content-muted">
                        {quiz?.document?.original_filename ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-content-muted">{new Date(timestamp).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">
                        {attempt.score ?? 0}/{attempt.max_score ?? 0}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={percentage >= 80 ? 'default' : percentage >= 50 ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {percentage.toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-content-muted">{formatDuration(attempt.duration_seconds)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/results/${attempt.id}`)}>
                            <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
                            View result
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleRetake(attempt)}>
                            <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
                            Retake
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