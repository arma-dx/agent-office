import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { blockStorage } from '../test/storage.ts';
import { clearStored, readStored, writeStored } from './stored.ts';

const viewSchema = z.object({
  view: z.enum(['list', 'board']),
  groupBy: z.enum(['status', 'none']),
});
const DEFAULT = { view: 'list', groupBy: 'status' } as const;
const KEY = 'agent-office.test.view';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stored values', () => {
  it('gives back what was stored, and the fallback for anything the schema refuses', () => {
    expect(readStored('local', KEY, viewSchema, DEFAULT)).toEqual(DEFAULT);
    writeStored('local', KEY, { view: 'board', groupBy: 'none' });
    expect(readStored('local', KEY, viewSchema, DEFAULT)).toEqual({
      view: 'board',
      groupBy: 'none',
    });
    // An older shape, an unknown value and text that is not JSON all give the default.
    localStorage.setItem(KEY, '{"view":"calendar","groupBy":"status"}');
    expect(readStored('local', KEY, viewSchema, DEFAULT)).toEqual(DEFAULT);
    localStorage.setItem(KEY, '{"view":"board"}');
    expect(readStored('local', KEY, viewSchema, DEFAULT)).toEqual(DEFAULT);
    localStorage.setItem(KEY, 'not json');
    expect(readStored('local', KEY, viewSchema, DEFAULT)).toEqual(DEFAULT);
  });

  it('keeps the two storages apart and removes a value with null', () => {
    writeStored('session', KEY, { view: 'board', groupBy: 'none' });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readStored('session', KEY, viewSchema, DEFAULT).view).toBe('board');
    writeStored('session', KEY, null);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('works without storage', () => {
    blockStorage();
    expect(() => {
      writeStored('local', KEY, DEFAULT);
      writeStored('session', KEY, null);
      clearStored('session', 'agent-office.');
    }).not.toThrow();
    expect(readStored('local', KEY, viewSchema, DEFAULT)).toEqual(DEFAULT);
  });

  it('removes every key under a prefix and leaves the rest', () => {
    writeStored('session', 'agent-office.draft.u1.c1.request', 'yarım metin');
    writeStored('session', 'agent-office.draft.u1.c2.request', 'öteki şirket');
    writeStored('session', 'agent-office.other', 'kalır');
    clearStored('session', 'agent-office.draft.');
    expect(sessionStorage.getItem('agent-office.draft.u1.c1.request')).toBeNull();
    expect(sessionStorage.getItem('agent-office.draft.u1.c2.request')).toBeNull();
    expect(sessionStorage.getItem('agent-office.other')).not.toBeNull();
  });
});
