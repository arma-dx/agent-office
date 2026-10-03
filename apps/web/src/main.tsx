import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FRAMED_TEXT, isFramed } from '@/lib/frame';
import { createQueryClient } from '@/lib/query';
import { watchTheme } from '@/lib/theme';
import { createAppRouter } from './router.tsx';
import './index.css';

watchTheme();

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

if (isFramed(window)) {
  // Never inside another page: nothing to click, nothing to confirm.
  root.textContent = FRAMED_TEXT;
} else {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
