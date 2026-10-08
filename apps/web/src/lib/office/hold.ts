import { useEffect } from 'react';

/**
 * A confirmation of the office view is open: the switch of an agent, or "Her yerde durdur". What
 * the person is about to confirm must not change under the dialog (a stop that became an opening
 * because somebody else stopped the agent meanwhile), so while one is open the office is not read
 * again by itself: the timer of lib/refresh.ts is paused and coming back to the tab does not
 * fetch. The person sends and reads the API's own answer; the office is read again afterwards.
 *
 * Module state, as lib/requests/hold.ts: one tab shows one dialog at a time; the count is for
 * safety.
 */
let open = 0;

/** True while a confirmation of the office view is open; `paused` of the background refresh. */
export function officeDialogOpen(): boolean {
  return open > 0;
}

/** Call in the component that renders the dialog, with whether it is open. */
export function useOfficeDialog(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    open += 1;
    return () => {
      open -= 1;
    };
  }, [isOpen]);
}
