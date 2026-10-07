import { useRef } from 'react';

/**
 * Gives the focus back to the control that opened a dialog. The dialogs of the request screens
 * have no trigger of their own (they are opened from state, and some are mounted only while
 * open), so the dialog library cannot know where the focus came from: a field that takes the
 * focus when the dialog opens is all it sees. The opener is remembered when it is pressed and
 * focused again when the dialog has closed; if it is gone by then (the card it sat on was
 * decided), the focus stays where the library put it.
 */
export function useReturnFocus(): {
  /** Call in the handler that opens the dialog. */
  remember: () => void;
  /** Pass to the dialog's content as `onCloseAutoFocus`. */
  onCloseAutoFocus: (event: Event) => void;
} {
  const opener = useRef<HTMLElement | null>(null);
  return {
    remember: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event) => {
      const control = opener.current;
      if (control?.isConnected) {
        event.preventDefault();
        control.focus();
      }
    },
  };
}
