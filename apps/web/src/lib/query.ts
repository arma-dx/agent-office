import { QueryClient } from '@tanstack/react-query';
import { isPermanentError } from './api.ts';

/** Query client: errors that retrying will not fix (4xx) are not retried; others at most 3 times. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isPermanentError(error) && failureCount < 3,
      },
    },
  });
}
