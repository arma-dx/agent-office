import { COMPANY_HEADER } from '@agent-office/shared';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARMADX, json, mockApi, sessionHandler } from './test/mock-api.ts';
import { renderApp } from './test/render-app.tsx';

// The Bugün screen (8 October decisions 7 and 8) and the two counts of the sidebar. Everything on
// screen is what the API answered: the list is a list of links, a notification is a fixed sentence
// built from a template code, and nothing here decides anything.

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function menu(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Ana menü' });
}

describe('the counts of the sidebar', () => {
  it('counts what is expected on the Bugün row and the decisions on the Onaylar row, from one light request', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'GET /today/counts': () => json({ today: 3, approvals: 2 }),
    });
    renderApp('/c/armadx/requests');
    expect(await screen.findByRole('link', { name: 'Bugün, 3 bekleyen iş' })).toBeVisible();
    expect(within(menu()).getByRole('link', { name: 'Onaylar, 2 bekleyen' })).toBeVisible();
    // One request for both numbers, for the selected company; the desk with its cards is not read.
    const counts = api.callsTo('GET /today/counts');
    expect(counts).toHaveLength(1);
    expect(counts[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(api.callsTo('GET /approvals')).toEqual([]);
    expect(api.unexpected).toEqual([]);

    // Nothing waits: the rows keep their plain names.
    cleanup();
    const quiet = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'GET /today/counts': () => json({ today: 0, approvals: 0 }),
    });
    renderApp('/c/armadx/requests');
    expect(await screen.findByRole('heading', { name: 'Henüz talep yok' })).toBeVisible();
    await vi.waitFor(() => {
      expect(quiet.callsTo('GET /today/counts')).toHaveLength(1);
    });
    expect(within(menu()).getByRole('link', { name: 'Bugün' })).toBeVisible();
    expect(within(menu()).getByRole('link', { name: 'Onaylar' })).toBeVisible();
    expect(within(menu()).queryByRole('link', { name: /bekleyen/ })).toBeNull();
  });
});
