import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog.tsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog.tsx';

// The backdrop was drawn with the text color (--ink), which is light in the dark theme: it
// brightened the page behind a dialog instead of dimming it.
describe('dialog backdrop', () => {
  it('dims the page with black behind a confirmation dialog', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Üyelikten çıkarılsın mı?</AlertDialogTitle>
          <AlertDialogDescription>Kişi bu şirkete giremez.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const backdrop = document.querySelector('[data-slot="alert-dialog-overlay"]');
    expect(backdrop).toHaveClass('fixed', 'inset-0', 'bg-black/40');
  });

  it('dims the page with black behind a dialog with a form', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Yeniden doğrulama</DialogTitle>
          <DialogDescription>Passkey ile doğrulayın.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
    expect(backdrop).toHaveClass('fixed', 'inset-0', 'bg-black/40');
  });
});
