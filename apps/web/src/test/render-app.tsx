import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { createQueryClient } from '@/lib/query';
import { createAppRouter } from '@/router';

/** Opens the whole panel at a path, with the real router and query client. */
export function renderApp(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

/** Current path and search of the app, for assertions. */
export function currentLocation(router: ReturnType<typeof renderApp>['router']) {
  return { pathname: router.state.location.pathname, search: router.state.location.search };
}
