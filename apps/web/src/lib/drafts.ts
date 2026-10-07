// The rules of this file follow Paperclip's draft storage (MIT License, Copyright (c) 2025
// Paperclip AI): ui/src/lib/composer-draft.ts (lines 1-94) and the draft part of
// ui/src/components/NewIssueDialog.tsx (lines 88-89, 218-234, 701-802) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: written anew as one module for the request form and the comment box; a draft belongs to
// one person in one company and lives in the tab's session storage, not in a key shared by every
// company and person in local storage; every draft is removed at sign-out; values are checked with
// a schema when read; no attachment receipts and no record of a send whose outcome is unknown.
import type { z } from 'zod';
import { clearStored, readStored, writeStored } from './stored.ts';

/**
 * Text a person has typed and not sent yet: the request form and the comment box of a task. A
 * draft is company text, so it is kept as little as is still useful. What the browser may keep is
 * an open question for the founder (docs/SONRA.md, U13); until it is answered this is a default,
 * listed with the other defaults of the request flow:
 * - per person and company: one person's draft never opens for another, or in another company;
 * - in the tab's session storage: it survives a reload and the trip to the login screen and back
 *   when the session timed out, and is gone when the tab is closed. It has to survive the timeout:
 *   the idle limit counts requests, not keystrokes, so a person who writes a long request for
 *   half an hour is signed out while typing, and the draft is what keeps the text;
 * - removed when the text is sent or discarded, and all drafts of the tab when the person signs
 *   out in it. Another tab keeps its own until it is closed.
 */
const DRAFT_PREFIX = 'agent-office.draft.';
const DRAFT_STORAGE = 'session';

/** A draft is written this long after the last change (as in Paperclip). */
export const DRAFT_SAVE_MS = 800;

/** The key of one draft; `name` says which box ("request", "comment.<task id>"). */
export function draftKey(userId: string, companyId: string, name: string): string {
  return `${DRAFT_PREFIX}${userId}.${companyId}.${name}`;
}

const pending = new Map<string, { timer: number; value: unknown }>();

/**
 * The draft kept under the key, checked with its schema; null when there is none. A draft that
 * still waits to be written is the newest one: a box that is closed and opened again within a
 * moment gets back what was typed, not what the storage still holds.
 */
export function readDraft<T>(key: string, schema: z.ZodType<T>): T | null {
  const waiting = pending.get(key);
  if (waiting) {
    const parsed = schema.safeParse(waiting.value);
    return waiting.value !== null && parsed.success ? parsed.data : null;
  }
  return readStored<T | null>(DRAFT_STORAGE, key, schema, null);
}

function cancel(key: string): void {
  const waiting = pending.get(key);
  if (waiting) window.clearTimeout(waiting.timer);
  pending.delete(key);
}

/** Stores a draft at once; null removes it (the text was sent or discarded). */
export function saveDraft(key: string, value: unknown): void {
  cancel(key);
  writeStored(DRAFT_STORAGE, key, value);
}

/**
 * Stores a draft a moment after the last change, so that typing does not write on every key. The
 * write does not depend on the component that asked for it: closing the form does not lose it.
 */
export function saveDraftSoon(key: string, value: unknown): void {
  cancel(key);
  const timer = window.setTimeout(() => {
    pending.delete(key);
    writeStored(DRAFT_STORAGE, key, value);
  }, DRAFT_SAVE_MS);
  pending.set(key, { timer, value });
}

/** Writes every draft that still waits (the page is being left). */
export function flushDrafts(): void {
  for (const [key, { value }] of Array.from(pending)) saveDraft(key, value);
}

/** Removes every draft kept in this tab (sign-out), also those that still wait to be written. */
export function clearDrafts(): void {
  for (const key of Array.from(pending.keys())) cancel(key);
  clearStored(DRAFT_STORAGE, DRAFT_PREFIX);
}
