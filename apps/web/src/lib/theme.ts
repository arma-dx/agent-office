// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/context/ThemeContext.tsx, ui/src/components/ThemeToggle.tsx and the script in
// ui/index.html that applies the stored theme before the first paint, at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: only the idea was taken (follow the device until the person chooses, store an explicit
// choice, apply it before the first paint); data-theme instead of a class, our storage key, a
// third choice "system" to go back, and an external store instead of a context.
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

/** What the person picked in the account menu. "system" follows the device and is the default. */
export const themeChoiceSchema = z.enum(['system', 'light', 'dark']);
export type ThemeChoice = z.infer<typeof themeChoiceSchema>;
export type Theme = 'light' | 'dark';

/** The choices in the order the account menu lists them. */
export const THEME_CHOICES = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
] as const satisfies readonly { value: ThemeChoice; label: string }[];

/**
 * Browser storage holds the choice only; nothing about the person or a company. The inline script
 * in apps/web/index.html reads the same key before the first paint (lib/theme.test.ts checks it).
 */
export const THEME_STORAGE_KEY = 'agent-office.theme';
const SYSTEM_DARK = '(prefers-color-scheme: dark)';

function readChoice(): ThemeChoice {
  try {
    return themeChoiceSchema.catch('system').parse(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked; the panel then follows the device.
    return 'system';
  }
}

function resolve(choice: ThemeChoice): Theme {
  if (choice !== 'system') return choice;
  return window.matchMedia(SYSTEM_DARK).matches ? 'dark' : 'light';
}

let choice: ThemeChoice = 'system';
let theme: Theme = 'light';
const listeners = new Set<() => void>();

function apply(root: HTMLElement) {
  theme = resolve(choice);
  root.dataset['theme'] = theme;
  for (const listener of listeners) listener();
}

/**
 * Sets data-theme on the root element from the stored choice and keeps following the device while
 * the choice is "system". Called once before React renders. Returns a function that stops it.
 */
export function startTheme(root: HTMLElement = document.documentElement): () => void {
  choice = readChoice();
  const query = window.matchMedia(SYSTEM_DARK);
  const onSystemChange = () => {
    apply(root);
  };
  apply(root);
  query.addEventListener('change', onSystemChange);
  return () => {
    query.removeEventListener('change', onSystemChange);
  };
}

/** Stores the choice (nothing is stored for "system") and applies it at once. */
export function setThemeChoice(next: ThemeChoice, root: HTMLElement = document.documentElement) {
  choice = next;
  try {
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The choice still holds until the page is closed.
  }
  apply(root);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The choice shown as selected in the account menu. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}

/** The theme in effect; the toaster follows it. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => theme);
}
