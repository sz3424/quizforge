import React, { createContext, useContext } from 'react';
import axios, { AxiosInstance } from 'axios';

/**
 * Base URL of the FastAPI backend.
 *
 * Resolution order:
 *   1. VITE_API_BASE - set in the hosting platform's build environment.
 *   2. Same origin ('') - correct when the API is served from the same domain
 *      or behind a reverse proxy such as the Netlify proxy in netlify.toml.
 *
 * There is deliberately NO localhost fallback. A previous fallback to
 * http://127.0.0.1:8000 was baked into production bundles whenever
 * VITE_API_BASE was unset at build time, so the deployed app silently called
 * the visitor's own machine and reported "Couldn't reach the backend".
 */
export const API_BASE_URL = (
  (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
).replace(/\/$/, '');

export const API_PREFIX = '/api';

/** True when the backend is same-origin (no cross-origin CORS involved). */
export const IS_SAME_ORIGIN = API_BASE_URL === '';

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
      // Network-level failure with no response. The correct advice differs
      // between a local dev session and a deployed app, so say something true.
      return IS_SAME_ORIGIN
        ? "Couldn't reach the backend. The app called the same origin (/api); check that the API is deployed and the proxy rule is in place."
        : `Couldn't reach the backend at ${API_BASE_URL}. Check that the API is deployed, that VITE_API_BASE is correct, and that the backend's CORS_ORIGINS allows this site's origin.`;
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'The backend took too long to respond. It may be starting up or processing a large file — please try again.';
    }
    if (error.response.status === 413) {
      return 'That file is too large for the backend to accept.';
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