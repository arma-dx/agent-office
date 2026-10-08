import { useEffect } from 'react';

/**
 * A decision dialog is open: a reason is being typed, or a passkey is being asked for. What the
 * person decides on must not change under the dialog, and the dialog must not disappear with the
 * card it belongs to when somebody else closed the approval meanwhile. So while one is open the
 * pages that show these cards read nothing again by themselves: the timer of lib/refresh.ts is
 * paused and coming back to the tab does not fetch. The person then sends and reads the API's own
 * answer in the dialog ("Bu onay kapanmış ..."), with the typed text still there, and the page is
 * read again when the dialog closes.
 *
 * Module state: the request page and the Onaylar screen read the same data from different places,
 * and one tab shows one dialog at a time. The count is for safety. (The numbers of the sidebar are
 * not held: they come from their own light request and move nothing the person aims at.)
 */
let open = 0;

/** True while a decision dialog is open; `paused` of the background refresh. */
export function decisionDialogOpen(): boolean {
  return open > 0;
}

/** Call in the card that renders the dialog, with whether one of its dialogs is open. */
export function useDecisionDialog(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    open += 1;
    return () => {
      open -= 1;
    };
  }, [isOpen]);
}
