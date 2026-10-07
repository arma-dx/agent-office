import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { blockStorage } from '../test/storage.ts';
import {
  clearDrafts,
  DRAFT_SAVE_MS,
  draftKey,
  flushDrafts,
  readDraft,
  saveDraft,
  saveDraftSoon,
} from './drafts.ts';

const text = z.string();
const MINE = draftKey('user-1', 'company-1', 'request');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  clearDrafts();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('drafts', () => {
  it('keeps a draft per person, company and box', () => {
    saveDraft(MINE, 'Teklif taslağı');
    expect(readDraft(MINE, text)).toBe('Teklif taslağı');
    expect(readDraft(draftKey('user-2', 'company-1', 'request'), text)).toBeNull();
    expect(readDraft(draftKey('user-1', 'company-2', 'request'), text)).toBeNull();
    expect(readDraft(draftKey('user-1', 'company-1', 'comment.t1'), text)).toBeNull();
  });

  it('lives in the session storage of the tab, never in local storage', () => {
    saveDraft(MINE, 'Teklif taslağı');
    expect(sessionStorage.getItem(MINE)).toBe('"Teklif taslağı"');
    expect(localStorage.length).toBe(0);
  });

  it('writes a moment after the last change, not on every key', () => {
    saveDraftSoon(MINE, 'T');
    vi.advanceTimersByTime(DRAFT_SAVE_MS - 1);
    saveDraftSoon(MINE, 'Te');
    vi.advanceTimersByTime(DRAFT_SAVE_MS - 1);
    expect(sessionStorage.getItem(MINE)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(sessionStorage.getItem(MINE)).toBe('"Te"');
    expect(readDraft(MINE, text)).toBe('Te');
  });

  it('reads back a draft that still waits to be written: a box closed and opened at once', () => {
    saveDraft(MINE, 'Eski');
    saveDraftSoon(MINE, 'Yeni');
    expect(readDraft(MINE, text)).toBe('Yeni');
    // A text that was emptied a moment ago is no draft, whatever the storage still holds.
    saveDraftSoon(MINE, null);
    expect(readDraft(MINE, text)).toBeNull();
  });

  it('a sent or discarded text removes its draft, also one that still waits to be written', () => {
    saveDraftSoon(MINE, 'Gönderilecek');
    saveDraft(MINE, null);
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    expect(readDraft(MINE, text)).toBeNull();
  });

  it('writes what still waits when the page is left', () => {
    saveDraftSoon(MINE, 'Yarım');
    flushDrafts();
    expect(readDraft(MINE, text)).toBe('Yarım');
  });

  it('sign-out removes every draft of the tab and nothing else', () => {
    const other = draftKey('user-1', 'company-2', 'comment.t1');
    saveDraft(MINE, 'bir');
    saveDraftSoon(other, 'iki');
    sessionStorage.setItem('unrelated', 'kalır');
    localStorage.setItem('agent-office.theme', 'dark');
    clearDrafts();
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    expect(readDraft(MINE, text)).toBeNull();
    expect(readDraft(other, text)).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('kalır');
    expect(localStorage.getItem('agent-office.theme')).toBe('dark');
  });

  it('gives nothing for a stored value of another shape, and works without storage', () => {
    sessionStorage.setItem(MINE, '{"title":1}');
    expect(readDraft(MINE, text)).toBeNull();
    blockStorage();
    expect(() => {
      saveDraft(MINE, 'x');
      saveDraftSoon(MINE, 'y');
      flushDrafts();
      clearDrafts();
    }).not.toThrow();
    expect(readDraft(MINE, text)).toBeNull();
  });
});
