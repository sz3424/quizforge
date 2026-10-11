import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ApiProvider } from './contexts/ApiContext';
import { ThemeProvider } from './hooks/useTheme';
import { ToastProvider } from './components/ui/Toast';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { CreateQuiz } from './pages/CreateQuiz';
import { QuizReview } from './pages/QuizReview';
import { QuizPlayer } from './pages/Quiz';
import { Results } from './pages/Results';
import { MyQuizzes } from './pages/MyQuizzes';
import { History } from './pages/History';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ApiProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/create" element={<CreateQuiz />} />
                <Route path="/quizzes" element={<MyQuizzes />} />
                <Route path="/quizzes/:quizId/review" element={<QuizReview />} />
                <Route path="/quiz/:quizId" element={<QuizPlayer />} />
                <Route path="/results/:attemptId" element={<Results />} />
                <Route path="/history" element={<History />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ApiProvider>
      </ToastProvider>
    </ThemeProvider>
  );
};

const NotFound: React.FC = () => (
  <div className="rounded-lg border border-border px-6 py-16 text-center">
    <h1 className="text-2xl font-bold">Page not found</h1>
    <p className="mt-2 text-sm text-muted">The page you were looking for doesn't exist.</p>
    <a
      href="/"
      className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
    >
      Back to Dashboard
    </a>
  </div>
);

export default App;