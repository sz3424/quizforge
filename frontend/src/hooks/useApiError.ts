import { useApiContext, describeApiError } from '@/contexts/ApiContext';
import type { AxiosInstance } from 'axios';

/**
 * Bundles the axios instance with the error-description helper so pages can
 * import both from one place.
 */
export const useApi = (): AxiosInstance => useApiContext().api;

export { describeApiError };