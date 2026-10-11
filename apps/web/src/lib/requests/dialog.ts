import { createContext, use } from 'react';

/** The project the form opens with: its id, and its name to show before the list is read. */
export interface RequestProject {
  id: string;
  name: string;
}

/** Opens the "Yeni talep" dialog of the shell; provided by RequestDialogProvider. */
export interface RequestDialogOpeners {
  /** Takes no argument on purpose: it is used as a click handler. */
  open: () => void;
  /** Opens the form with this project chosen (the project page). */
  openFor: (project: RequestProject) => void;
}

export const RequestDialogContext = createContext<RequestDialogOpeners | null>(null);

/** Null where no request can be opened: for an external person, and in Kurucu alanı. */
export function useOpenRequestDialog(): (() => void) | null {
  return use(RequestDialogContext)?.open ?? null;
}

/** As useOpenRequestDialog, for a button that opens the form inside one project. */
export function useOpenRequestDialogFor(): ((project: RequestProject) => void) | null {
  return use(RequestDialogContext)?.openFor ?? null;
}
