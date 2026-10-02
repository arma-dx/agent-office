import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { sorguIstemcisiOlustur } from '@/lib/sorgu';
import { temayiIzle } from '@/lib/tema';
import { createAppRouter } from './router.tsx';
import './index.css';

temayiIzle();

const queryClient = sorguIstemcisiOlustur();
const router = createAppRouter({ queryClient });

const root = document.getElementById('root');
if (!root) throw new Error('root öğesi bulunamadı');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
