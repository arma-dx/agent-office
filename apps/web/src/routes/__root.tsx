import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { BarePage } from '@/components/layout';
import { NotFoundScreen } from '@/components/screens';
import { Toaster } from '@/components/ui/sonner';
import { trackInputKind } from '@/lib/input-kind';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RootNotFound,
});

function RootLayout() {
  // Lets the stylesheet tell a menu used with the mouse from one used with the keyboard.
  useEffect(() => trackInputKind(), []);
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

function RootNotFound() {
  return (
    <BarePage>
      <NotFoundScreen />
    </BarePage>
  );
}
