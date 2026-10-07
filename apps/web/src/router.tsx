import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { ErrorScreen, NotFoundScreen } from '@/components/screens';
import type { PageLocation } from '@/lib/location';
import { routeTree } from './routeTree.gen.ts';

export function createAppRouter(opts: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: { queryClient: opts.queryClient },
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFoundScreen,
    defaultErrorComponent: ErrorScreen,
    ...(opts.history ? { history: opts.history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
  interface StaticDataRouteOption {
    /**
     * Where the page sits in the panel. The top bar shows it (the label is the page's h1).
     * `parent` names a group that has no page of its own (text) or, for a detail page, the page it
     * belongs to (a link back). A detail page names its record with <PageLabel>; the label here
     * shows until the record is known. Every page under /c/$company declares one; shell.test.tsx
     * fails for a page that does not.
     */
    location?: PageLocation;
    /** The page fills the content area itself: no padding around it (the office view's canvas). */
    fullBleed?: boolean;
  }
}
