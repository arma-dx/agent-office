import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMIT_REACHED, NO_REQUEST_AT_LIMIT } from './lib/projects/labels.ts';
import { json, mockApi, type Handler } from './test/mock-api.ts';
import {
  EMPLOYEE_AT_ARMADX,
  project,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  projectRun,
  projectRuns,
  projectRunsRoute,
  sessionAs,
} from './test/project-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

// The AI spending limit of a project (8 October decision 17) on the project's own screens: what
// every reader is told when it is reached, and the founder's block on the "Çalışmalar" tab.

afterEach(() => {
  vi.unstubAllGlobals();
});

const LIST = '/c/armadx/projects';
const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const RUNS_TAB = `${PATH}?tab=runs`;

/** A project where agents may work, open for requests. */
const OPEN = { aiAllowed: true, agentsMayWork: true, customer: null };

function listOf(...projects: ReturnType<typeof project>[]): Handler {
  return () => json({ projects, truncated: false });
}

describe('projects: a reached AI spending limit, for every reader', () => {
  it('limit: a member sees no figure, and the banner above the tabs when the limit is reached', async () => {
    mockApi(
      projectHandlers(projectForEmployee({ ...OPEN, spendingLimitReached: true }), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [projectRunsRoute()]: () => json(projectRuns([projectRun()])),
      }),
    );
    renderApp(RUNS_TAB);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const banner = screen.getByText(LIMIT_REACHED.others);
    expect(banner).toBeVisible();
    // Above the tabs: it is said on every tab of the page.
    const tabs = screen.getByRole('tablist', { name: 'Proje bölümleri' });
    expect(banner.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(LIMIT_REACHED.founder)).toBeNull();
    // The member learns that the limit is reached, and nothing of the money: no block, no
    // figure, no button on the "Çalışmalar" tab.
    const panel = await screen.findByRole('tabpanel', { name: 'Çalışmalar' });
    await within(panel).findByRole('table');
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/\$|Harcanan|Kalan|Sınır belirle/);
    cleanup();

    // The founder is told where the limit is raised.
    mockApi(
      projectHandlers(
        projectDetail({
          ...OPEN,
          spendingLimitReached: true,
          aiSpending: { limitUsd: '25.00', spentUsd: '25.004100' },
          actions: { ...projectDetail().actions, setAiSpendingLimit: true },
        }),
      ),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(screen.getByText(LIMIT_REACHED.founder)).toBeVisible();
    expect(screen.queryByText(LIMIT_REACHED.others)).toBeNull();
    cleanup();

    // A limit that is not reached is not mentioned to anybody on the page's head.
    mockApi(
      projectHandlers(projectForEmployee(OPEN), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/harcama sınırı/);
  });

  it('the project list says Harcama sınırı doldu for such a project', async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': listOf(
          project({ ...OPEN, name: 'Lansman', spendingLimitReached: true }),
          project({
            ...OPEN,
            id: 'a2222222-2222-4222-8222-222222222222',
            name: 'Çağrı merkezi',
          }),
          // The permission is said first: while it is closed the limit changes nothing.
          project({
            id: 'a3333333-3333-4333-8333-333333333333',
            name: 'Depo otomasyonu',
            spendingLimitReached: true,
          }),
        ),
      }),
    );
    renderApp(LIST);
    const row = (name: string) => {
      const item = screen.getByRole('link', { name: new RegExp(`^${name}\\.`) }).closest('li');
      if (!item) throw new Error(`No row for ${name}`);
      return item;
    };
    await screen.findByRole('link', { name: /^Lansman\./ });
    const atLimit = within(row('Lansman')).getByText('Harcama sınırı doldu');
    expect(atLimit).toBeVisible();
    expect(atLimit.className).toContain('text-ink-secondary');
    const free = within(row('Çağrı merkezi')).getByText('Ajanlar çalışabilir');
    expect(free.className).not.toContain('text-ink-secondary');
    expect(within(row('Depo otomasyonu')).getByText('Ajanlar çalışamaz')).toBeVisible();
    expect(row('Depo otomasyonu')).not.toHaveTextContent('Harcama sınırı doldu');
    // The row's link says the same.
    expect(screen.getByRole('link', { name: /^Lansman\./ })).toHaveAccessibleName(
      /Harcama sınırı doldu\./,
    );
  });

  it('the Talepler tab does not offer a new request in a project at its limit', async () => {
    mockApi(projectHandlers(projectDetail({ ...OPEN, spendingLimitReached: true })));
    renderApp(PATH);
    const panel = await screen.findByRole('tabpanel', { name: 'Talepler' });
    await within(panel).findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(within(panel).getByText(NO_REQUEST_AT_LIMIT.founder)).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Bu projede talep aç' })).toBeNull();
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee({ ...OPEN, spendingLimitReached: true }), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      }),
    );
    renderApp(PATH);
    const other = await screen.findByRole('tabpanel', { name: 'Talepler' });
    await within(other).findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(within(other).getByText(NO_REQUEST_AT_LIMIT.others)).toBeVisible();
    expect(within(other).queryByRole('button', { name: 'Bu projede talep aç' })).toBeNull();
    cleanup();

    // A closed AI permission is the reason that is said when both hold.
    mockApi(
      projectHandlers(
        projectDetail({ aiAllowed: false, agentsMayWork: false, spendingLimitReached: true }),
      ),
    );
    renderApp(PATH);
    const both = await screen.findByRole('tabpanel', { name: 'Talepler' });
    await within(both).findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(both).toHaveTextContent('Bu projede ajanlar çalışamadığı için talep açılamaz.');
    expect(both).not.toHaveTextContent('harcama sınırı');
    cleanup();

    // With the limit not reached the button is there.
    mockApi(projectHandlers(projectDetail(OPEN)));
    renderApp(PATH);
    const free = await screen.findByRole('tabpanel', { name: 'Talepler' });
    expect(await within(free).findByRole('button', { name: 'Bu projede talep aç' })).toBeVisible();
  });
});
