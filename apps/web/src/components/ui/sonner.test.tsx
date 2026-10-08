import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import { Toaster } from './sonner.tsx';

describe('Toaster', () => {
  it('names its region in Turkish, without a shortcut', () => {
    render(<Toaster />);
    expect(screen.getByRole('region', { name: 'Anlık bildirimler' })).toBeInTheDocument();
  });

  it('leaves the focus in a field when Alt+T is pressed while a toast is on screen', async () => {
    render(
      <>
        <input aria-label="Tutar" />
        <Toaster />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'Tutar' });
    field.focus();
    act(() => {
      toast.error('Kayıt bulunamadı.');
    });
    await screen.findByText('Kayıt bulunamadı.');
    // Alt+T (AltGr+T, Option+T) types the lira sign on a Turkish Q keyboard.
    fireEvent.keyDown(field, { altKey: true, code: 'KeyT', key: '₺' });
    expect(field).toHaveFocus();
  });

  it('draws a toast without a shadow and with our focus outline', async () => {
    render(<Toaster />);
    act(() => {
      toast('Kaydedildi.');
    });
    const box = (await screen.findByText('Kaydedildi.')).closest('[data-sonner-toast]');
    // sonner draws its focus ring as a box-shadow; without the shadow the ring is our outline.
    expect(box).toHaveClass(
      'shadow-none!',
      'focus-visible:outline-2!',
      'focus-visible:outline-offset-2!',
      'focus-visible:outline-ring!',
    );
  });
});
