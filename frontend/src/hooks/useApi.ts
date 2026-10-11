import { useApiContext } from '@/contexts/ApiContext';
import type { AxiosInstance } from 'axios';

/**
 * Thin accessor so components can pull the shared axios instance without
 * importing the context module directly.
 */
export const useApi = (): AxiosInstance => useApiContext().api;