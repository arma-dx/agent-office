import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('başlığı gösterir', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Agent Office' })).toBeInTheDocument();
  });
});
