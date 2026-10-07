import { createContext, use } from 'react';

/** Opens the "Yeni talep" dialog of the shell; provided by RequestDialogProvider. */
export const RequestDialogContext = createContext<(() => void) | null>(null);

/** Null where no request can be opened: for an external person, and in Kurucu alanı. */
export function useOpenRequestDialog(): (() => void) | null {
  return use(RequestDialogContext);
}
