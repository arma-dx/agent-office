import { BACKGROUND_HEADER } from '@agent-office/shared';
import { onlineManager } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, sessionHandler } from './test/mock-api.ts';
import { renderApp } from './test/render-app.tsx';

// Rule 3: a session closes after 30 minutes without activity. Activity is what the person does.
// Whatever the panel sends by itself (a timer, the network coming back) is either sent as a
// background request, which the API does not count, or not sent at all. These tests keep the
// second half; lib/refresh.test.tsx and the page tests keep the first.

/** Lets the query client act on an event, then gives every request it started time to leave. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('requests nobody caused', () => {
  it('the network coming back sends nothing, on a page that only holds the session', async () => {
    const api = mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeInTheDocument();
    await settle();
    const before = api.calls.length;
    expect(before).toBeGreaterThan(0);
    // An unattended laptop on a Wi-Fi or a VPN that drops and returns, again and again.
    for (let round = 0; round < 3; round += 1) {
      act(() => {
        onlineManager.setOnline(false);
      });
      act(() => {
        onlineManager.setOnline(true);
      });
      await settle();
    }
    const unmarked = api.calls
      .slice(before)
      .filter((call) => call.headers.get(BACKGROUND_HEADER) === null);
    expect(unmarked.map((call) => `${call.method} ${call.path}`)).toEqual([]);
    expect(api.calls).toHaveLength(before);
  });
});

// The source of the panel, read the way design-rules.test.ts reads it (node:fs is not allowed in
// panel code).
const sources = import.meta.glob<string>(
  ['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx', '!./test/**'],
  { query: '?raw', import: 'default', eager: true },
);

/** The code of a file without its comments, which may name an option in order to explain it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * A query that fetches on a timer sends requests nobody caused, and its query function cannot
 * tell a timer from a click: unmarked, they keep an unattended session open up to the 10 hour
 * limit. A page that refreshes uses useBackgroundRefresh (lib/refresh.ts), which sends background
 * requests. The files below are the exceptions, each with the reason it is safe.
 */
const TIMER_QUERIES: Record<string, string> = {
  // The options of the passkey dialog (one query, configured in these two files) are renewed
  // every 3 minutes while the dialog is open; every request of that query function is sent as a
  // background request, checked below.
  './lib/passkeys.ts': 'background: true',
  './lib/step-up.ts': 'stepUpOptionsQueryOptions',
};

describe('queries on a timer', () => {
  it('reads the source of the panel', () => {
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(['./lib/refresh.ts', './lib/passkeys.ts', './lib/requests/query.ts']),
    );
  });

  it('are only the listed ones, and each sends background requests', () => {
    const withTimer = Object.entries(sources)
      .filter(([, text]) => /\brefetchInterval\b/.test(code(text)))
      .map(([file]) => file)
      .sort();
    expect(withTimer).toEqual(Object.keys(TIMER_QUERIES).sort());
    for (const [file, proof] of Object.entries(TIMER_QUERIES)) {
      expect(code(sources[file] ?? ''), file).toContain(proof);
    }
  });

  it('never fetch again by themselves when the network returns', () => {
    // The default of the query client (lib/query.ts) switches it off; no query switches it on.
    expect(code(sources['./lib/query.ts'] ?? '')).toContain('refetchOnReconnect: false');
    const switchedOn = Object.entries(sources)
      .filter(([, text]) => /refetchOnReconnect:\s*(?!false|\s)/.test(code(text)))
      .map(([file]) => file);
    expect(switchedOn).toEqual([]);
  });
});
