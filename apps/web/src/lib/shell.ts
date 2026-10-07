// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/context/SidebarContext.tsx and ui/src/context/PanelContext.tsx at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: one context for both; the sidebar choice is stored too; the panel is closed by default
// and takes its content through a host element (a portal) instead of a node held in state; a page
// may ask for the panel while its content exists; the phone drawer, the icon rail and the maximize
// request were removed.
import { createContext, useContext } from 'react';

/** What a page says about the properties it registers. */
export interface PanelOptions {
  /** Show the panel while these properties exist, whatever the person's choice is. */
  open?: boolean;
}

/** Layout state of the app shell: the sidebar and the properties panel. */
export interface ShellValue {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** The person's choice; the panel shows only while a page has put content in it. */
  panelOpen: boolean;
  togglePanel: () => void;
  /** True while a page on screen has registered properties. */
  panelInUse: boolean;
  /**
   * True while a page on screen asks for the panel: its properties describe a selection that the
   * page clears itself (the office view). The panel then shows without the person's choice being
   * read or written, and it has no toggle.
   */
  panelRequested: boolean;
  /** Called by a page's panel content while it is mounted; returns the function that undoes it. */
  registerPanel: (options?: PanelOptions) => () => void;
  /** The element the page's properties are rendered into. */
  panelHost: HTMLElement | null;
  setPanelHost: (element: HTMLElement | null) => void;
  /**
   * The name of the record a detail page shows (a task's title). While it is set the top bar shows
   * it as the page name instead of the label the route declares.
   */
  pageLabel: string | null;
  /** Called by a page's <PageLabel> while it is mounted; returns the function that undoes it. */
  registerPageLabel: (label: string) => () => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell must be used inside the app shell');
  return shell;
}

/** Element ids the toggle buttons point at (aria-controls). */
export const SIDEBAR_ID = 'sidebar';
export const PROPERTIES_PANEL_ID = 'properties-panel';

/**
 * The shell keeps layout choices only; nothing about the person or a company. What the task
 * screens keep in the browser (a view per person and company, unsent texts) has its own rules:
 * lib/tasks/view.ts and lib/drafts.ts.
 */
export const SIDEBAR_STORAGE_KEY = 'agent-office.sidebar';
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
