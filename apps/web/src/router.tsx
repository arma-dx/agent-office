import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { BulunamadiEkrani, HataEkrani } from '@/components/ekranlar';
import { routeTree } from './routeTree.gen.ts';

export function createAppRouter(opts: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: { queryClient: opts.queryClient },
    defaultPreload: 'intent',
    defaultNotFoundComponent: BulunamadiEkrani,
    defaultErrorComponent: HataEkrani,
    ...(opts.history ? { history: opts.history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
