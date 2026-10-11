import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { useApi, describeApiError } from '@/hooks/useApiError';
import type { ProviderStatus } from '@/types';
import { AlertCircle, CheckCircle2, Download, Loader2, Server, Trash2 } from 'lucide-react';

type ThemePreference = Theme;

interface Preferences {
  default_question_count: number;
  default_difficulty: string;
  default_question_types: string[];
  shuffle_questions: boolean;
  show_explanations: boolean;
  show_source_pages: boolean;
}

const STORAGE_KEY = 'quizforge.preferences';

const DEFAULT_PREFERENCES: Preferences = {
  default_question_count: 10,
  default_difficulty: 'medium',
  default_question_types: ['multiple_choice', 'true_false'],
  shuffle_questions: false,
  show_explanations: true,
  show_source_pages: true,
};

const readPreferences = (): Preferences => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const Settings: React.FC = () => {
  const api = useApi();
  const { theme, setTheme } = useTheme();
  const { success, error } = useToast();

  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [clearing, setClearing] = useState(false);

  const loadProviderStatus = useCallback(async () => {
    try {
      setChecking(true);
      const response = await api.get<ProviderStatus>('/settings/provider');
      setProvider(response.data);
    } catch (err) {
      console.error('Failed to read provider status:', err);
      setProvider(null);
    } finally {
      setChecking(false);
    }
  }, [api]);

  useEffect(() => {
    void loadProviderStatus();
  }, [loadProviderStatus]);

  const updatePreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((prev) => {
      const next = { ...prev, [key]: value };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleExportData = async () => {
    try {
      const response = await api.get('/data/export', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'quizforge-data.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      success('Export ready', 'Your documents, quizzes and attempts were downloaded.');
    } catch (err) {
      console.error('Failed to export data:', err);
      error('Export failed', describeApiError(err));
    }
  };

  const handleClearData = async () => {
    const confirmed = window.confirm(
      'Delete every stored document, quiz and attempt? Uploaded PDF files are removed too. This cannot be undone.'
    );
    if (!confirmed) return;

    setClearing(true);
    try {
      await api.delete('/data');
      success('All data cleared');
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error('Failed to clear data:', err);
      error('Could not clear data', describeApiError(err));
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-content-muted">Appearance, quiz defaults, AI provider status and data management.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Label htmlFor="theme-select">Theme</Label>
          <Select value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
            <SelectTrigger id="theme-select" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark (default)</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">Match system</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-content-muted">Your choice is stored in this browser only.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiz defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-content-muted">
            These apply to quizzes you create from now on. Existing quizzes keep their saved configuration.
          </p>

          <div className="grid gap-2">
            <Label htmlFor="default-count">Default question count</Label>
            <Select
              value={String(preferences.default_question_count)}
              onValueChange={(value) => updatePreference('default_question_count', Number(value))}
            >
              <SelectTrigger id="default-count" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20].map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count} questions
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="default-difficulty">Default difficulty</Label>
            <Select
              value={preferences.default_difficulty}
              onValueChange={(value) => updatePreference('default_difficulty', value)}
            >
              <SelectTrigger id="default-difficulty" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={preferences.shuffle_questions}
              onCheckedChange={(value) => updatePreference('shuffle_questions', value)}
            />
            Shuffle question order by default
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={preferences.show_explanations}
              onCheckedChange={(value) => updatePreference('show_explanations', value)}
            />
            Show explanations after submitting
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={preferences.show_source_pages}
              onCheckedChange={(value) => updatePreference('show_source_pages', value)}
            />
            Show source page references
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI question generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {checking ? (
            <p className="flex items-center gap-2 text-sm text-content-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Checking provider configuration…
            </p>
          ) : provider ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Server className="h-4 w-4 text-content-muted" aria-hidden="true" />
                <span className="text-sm font-medium">{provider.provider}</span>
                <Badge variant="secondary" className="text-xs">
                  {provider.model}
                </Badge>
                <Badge variant={provider.configured ? 'default' : 'destructive'} className="text-xs">
                  {provider.configured ? (
                    <>
                      <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                      Configured
                    </>
                  ) : (
                    <>
                      <AlertCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                      Not configured
                    </>
                  )}
                </Badge>
              </div>
              <p className="text-sm text-content-muted">{provider.message}</p>
              {!provider.configured && provider.missing_variables.length > 0 && (
                <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                  <p className="font-medium">Set these in the backend environment, then restart the server:</p>
                  <ul className="mt-1 list-inside list-disc text-content-muted">
                    {provider.missing_variables.map((variable) => (
                      <li key={variable}>
                        <code className="text-xs">{variable}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-content-muted">
                API keys are read from backend environment variables only. They are never sent to the browser, and this
                page cannot display or change them.
              </p>
              <Button variant="outline" onClick={() => void loadProviderStatus()}>
                Re-check configuration
              </Button>
            </>
          ) : (
            <p className="text-sm text-content-muted">
              Couldn't read the provider status from the backend. Check that the local server is running.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Export application data</p>
              <p className="text-xs text-content-muted">Download documents, quizzes, questions and attempts as JSON.</p>
            </div>
            <Button variant="outline" onClick={() => void handleExportData()}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Export data
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium text-destructive">Clear all local data</p>
              <p className="text-xs text-content-muted">
                Permanently deletes every document, uploaded PDF, quiz and attempt. This cannot be undone.
              </p>
            </div>
            <Button variant="destructive" onClick={() => void handleClearData()} loading={clearing}>
              {!clearing && <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />}
              Clear data
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};