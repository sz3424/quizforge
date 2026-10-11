import React, { createContext, useContext } from 'react';
import axios, { AxiosInstance } from 'axios';

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://127.0.0.1:8000';

export const API_PREFIX = '/api';

const api: AxiosInstance = axios.create({
  baseURL: `${API_BASE_URL}${API_PREFIX}`,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Normalize backend failures into user-safe messages so pages can surface a
 * useful string instead of a raw axios/stack-trace payload.
 */
export const describeApiError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return "Couldn't reach the backend. Check that the local server is running and try again.";
    }
    const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    return `Request failed with status ${error.response.status}.`;
  }
  return 'Something went wrong. Please try again.';
};

api.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error)
);

interface ApiContextValue {
  api: AxiosInstance;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export const ApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ApiContext.Provider value={{ api }}>{children}</ApiContext.Provider>
);

export const useApiContext = (): ApiContextValue => {
  const context = useContext(ApiContext);
  if (!context) {
    throw new Error('useApiContext must be used within an ApiProvider');
  }
  return context;
};

export default api;