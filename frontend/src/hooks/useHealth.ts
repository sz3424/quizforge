import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/contexts/ApiContext';

export type HealthStatus = 'checking' | 'online' | 'offline';

/**
 * Polls the backend health endpoint so the sidebar indicator reflects the real
 * connection state instead of assuming "connected" because the UI loaded.
 */
export const useHealth = (intervalMs = 30000) => {
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const mounted = useRef(true);

  const check = useCallback(async () => {
    try {
      const response = await api.get('/health', { timeout: 8000 });
      const ok = response.data?.status === 'healthy';
      if (mounted.current) {
        setStatus(ok ? 'online' : 'offline');
        setLastChecked(new Date());
      }
    } catch {
      if (mounted.current) {
        setStatus('offline');
        setLastChecked(new Date());
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    check();
    const id = setInterval(check, intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [check, intervalMs]);

  return { status, lastChecked, refresh: check };
};