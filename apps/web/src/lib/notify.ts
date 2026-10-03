import { toast } from 'sonner';
import { isUnauthorized, userMessage } from './api.ts';

/**
 * Shows a failed action as a short message. A 401 is not shown: the query client sends the
 * person to the login screen, which says the session closed.
 */
export function notifyError(error: unknown): void {
  if (isUnauthorized(error)) return;
  toast.error(userMessage(error));
}
