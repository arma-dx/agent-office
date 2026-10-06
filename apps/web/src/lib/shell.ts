// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/context/PanelContext.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the panel is closed by default and takes its content through a host element (a portal)
// instead of a node held in state; the maximize request was removed.
import { createContext, useContext } from 'react';

/** Layout state of the app shell: the properties panel. */
export interface ShellValue {
  /** The person's choice; the panel shows only while a page has put content in it. */
  panelOpen: boolean;
  togglePanel: () => void;
  /** True while a page on screen has registered properties. */
  panelInUse: boolean;
  /** Called by a page's panel content while it is mounted; returns the function that undoes it. */
  registerPanel: () => () => void;
  /** The element the page's properties are rendered into. */
  panelHost: HTMLElement | null;
  setPanelHost: (element: HTMLElement | null) => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell must be used inside the app shell');
  return shell;
}

/** Element ids of the shell regions; a toggle button points at its region (aria-controls). */
export const SIDEBAR_ID = 'sidebar';
export const PROPERTIES_PANEL_ID = 'properties-panel';

/** Browser storage holds layout choices only; nothing about the person or a company. */
export const PANEL_STORAGE_KEY = 'agent-office.panel';

/** True when the stored value of the key is `value`. A blocked storage reads as "not stored". */
export function readStoredFlag(key: string, value: string): boolean {
  try {
    return localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

/** Stores a layout choice; the default is stored as nothing. */
export function writeStoredFlag(key: string, value: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // The choice still holds until the page is closed.
  }
}
