import { BACKGROUND_HEADER, COMPANY_HEADER, type ProjectRun } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFull, formatWhen } from './lib/dates.ts';
import { apiError, ARMADX, json, mockApi } from './test/mock-api.ts';
import {
  EMPLOYEE_AT_ARMADX,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  projectRun,
  projectRuns,
  projectRunsRoute,
  sessionAs,
} from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The "Çalışmalar" tab of a project's page (8 October 2026, decision 17): the agent runs of the
// project for every reader of it; tokens and cost for the founder alone (docs/SONRA.md P-t).

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const TAB = `${PATH}?tab=runs`;
const RUNS = projectRunsRoute();

const id = (n: number) => `d${String(n).padStart(7, '0')}-1111-4111-8111-111111111111`;
const USAGE = {
  inputTokens: 5200,
  outputTokens: 1600,
  cacheWriteTokens: 300,
  cacheReadTokens: 900,
  costUsd: '0.012345',
};
const OTHER_USAGE = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: '1.662345',
};
const done = projectRun();
const open = projectRun({
  id: id(2),
  request: { id: 'e2222222-2222-4222-8222-222222222222', title: 'Kasım bülteni' },
  agent: { code: 'KOR-1', name: 'Ofis Koordinatörü' },
  status: 'running',
  finishedAt: null,
  durationMs: null,
  startedAt: '2026-10-08T09:30:00.000Z',
});

const tabPanel = () => screen.findByRole('tabpanel', { name: 'Çalışmalar' });
const table = () =>
  screen.findByRole('table', { name: 'Bu projedeki ajan çalışmaları, en yenisi üstte' });
/** The body rows of the table: the first row is the heads. */
const rows = (within_: HTMLElement) => within(within_).getAllByRole('row').slice(1);
const heads = (within_: HTMLElement) =>
  within(within_)
    .getAllByRole('columnheader')
    .map((head) => head.textContent);

describe('projects: the agent runs of a project', () => {
  it('the project page has the Çalışmalar tab, and ?tab=runs opens it', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), { [RUNS]: () => json(projectRuns([done])) }),
    );
    const { router } = renderApp(PATH);
    const tab = await screen.findByRole('tab', { name: 'Çalışmalar' });
    // The runs are read only when their tab is opened.
    expect(api.callsTo(RUNS)).toEqual([]);
    await userEvent.click(tab);
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'runs' } });
    });
    expect(await table()).toBeVisible();
    expect(api.callsTo(RUNS)).toHaveLength(1);
    expect(api.callsTo(RUNS)[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    cleanup();

    mockApi(projectHandlers(projectDetail(), { [RUNS]: () => json(projectRuns([done])) }));
    renderApp(TAB);
    expect(await screen.findByRole('tab', { name: 'Çalışmalar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await table()).toBeVisible();
  });

  it('runs: the tab is a table with a caption, one row per run and a link to its request', async () => {
    const loose = projectRun({ id: id(3), request: null, startedAt: '2026-10-07T09:00:00.000Z' });
    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [RUNS]: () => json(projectRuns([open, done, loose])),
      }),
    );
    renderApp(TAB);
    const list = await table();
    expect(within(await tabPanel()).getByText('Bu projede 3 ajan çalışması var.')).toBeVisible();
    expect(heads(list)).toEqual(['Talep', 'Başladı', 'Süre', 'Sonuç']);
    for (const head of within(list).getAllByRole('columnheader')) {
      expect(head).toHaveAttribute('scope', 'col');
    }
    const [first, second, third] = rows(list) as [HTMLElement, HTMLElement, HTMLElement];
    expect(rows(list)).toHaveLength(3);
    // The request's title is the link to the request; under it the agent, code and name.
    const link = within(second).getByRole('link', { name: 'Ekim bülteni taslağı' });
    expect(link).toHaveAttribute('href', '/c/armadx/requests/e1111111-1111-4111-8111-111111111111');
    expect(second).toHaveTextContent('SOS-2 Sosyal İçerik Yazım Ajanı');
    expect(first).toHaveTextContent('KOR-1 Ofis Koordinatörü');
    // When it started, as everywhere: short on the page, whole in the title.
    const started = within(second).getByText(formatWhen('2026-10-08T09:00:00.000Z'));
    expect(started.tagName).toBe('TIME');
    expect(started).toHaveAttribute('datetime', '2026-10-08T09:00:00.000Z');
    expect(started).toHaveAttribute('title', formatFull('2026-10-08T09:00:00.000Z'));
    expect(second).toHaveTextContent('38 sn.');
    expect(within(second).getByText('Tamamlandı')).toBeVisible();
    // A run without a request says so and links nowhere.
    expect(third).toHaveTextContent('Talebe bağlı değil');
    expect(within(third).queryByRole('link')).toBeNull();
    // Nothing in the list is a control: the links are the only stops of the keyboard.
    expect(within(await tabPanel()).queryByRole('button')).toBeNull();
    expect(within(list).getAllByRole('link')).toHaveLength(2);
  });

  it('runs: the founder sees the token and cost columns and the totals; a member sees neither a column nor a figure', async () => {
    const paid = [
      projectRun({ usage: USAGE }),
      projectRun({ id: id(2), usage: OTHER_USAGE, startedAt: '2026-10-08T08:00:00.000Z' }),
    ];
    mockApi(projectHandlers(projectDetail(), { [RUNS]: () => json(projectRuns(paid)) }));
    renderApp(TAB);
    const list = await table();
    expect(heads(list)).toEqual(['Talep', 'Başladı', 'Süre', 'Sonuç', 'Token', 'Maliyet']);
    const [first, second] = rows(list) as [HTMLElement, HTMLElement];
    // The sum of the four counts, and the cost with four decimals: a run costs fractions of a cent.
    expect(within(first).getAllByRole('cell')[4]).toHaveTextContent(/^8\.000/);
    expect(within(first).getAllByRole('cell')[5]).toHaveTextContent('$0,0123');
    expect(within(second).getAllByRole('cell')[4]).toHaveTextContent(/^1\.200/);
    expect(within(second).getAllByRole('cell')[5]).toHaveTextContent('$1,6623');
    // The totals are over all runs, each figure under its name.
    const panel = await tabPanel();
    const figure = (name: string) =>
      within(panel).getByText(name, { selector: 'dt' }).nextElementSibling;
    expect(figure('Toplam maliyet')).toHaveTextContent('$1,67');
    expect(figure('Girdi tokeni')).toHaveTextContent('6.200');
    expect(figure('Çıktı tokeni')).toHaveTextContent('1.800');
    expect(figure('Önbelleğe yazılan')).toHaveTextContent('300');
    expect(figure('Önbellekten okunan')).toHaveTextContent('900');
    cleanup();

    // A member: the same rows, and nothing of tokens or money anywhere in the tab.
    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [RUNS]: () => json(projectRuns([projectRun(), projectRun({ id: id(2) })])),
      }),
    );
    renderApp(TAB);
    const plain = await table();
    expect(heads(plain)).toEqual(['Talep', 'Başladı', 'Süre', 'Sonuç']);
    expect(rows(plain)).toHaveLength(2);
    for (const row of rows(plain)) expect(within(row).getAllByRole('cell')).toHaveLength(4);
    const other = await tabPanel();
    expect(other).toHaveTextContent('Bu projede 2 ajan çalışması var.');
    expect(other).not.toHaveTextContent(/token|maliyet|\$/i);
    expect(within(other).queryByRole('term')).toBeNull();
  });

  it('runs: the result is the status word with its reason, never a code', async () => {
    const result = (n: number, status: ProjectRun['status'], errorCode: string | null) =>
      projectRun({ id: id(n), status, errorCode });
    const cases: [ProjectRun, string][] = [
      [result(1, 'limit_reached', 'tool_call_limit'), 'Sınıra takıldıaraç çağrısı sınırı'],
      [result(2, 'limit_reached', 'time_limit'), 'Sınıra takıldısüre sınırı'],
      [result(3, 'stopped', 'agent_stopped'), 'Durdurulduajan durduruldu'],
      [result(4, 'stopped', 'ai_permission_closed'), 'Durdurulduyapay zekâ izni kapandı'],
      [result(5, 'stopped', 'identity_changed'), 'Durduruldukurucunun adına yeniden başladı'],
      [result(6, 'stopped', 'request_changed'), 'Durduruldutalep değişti'],
      [result(11, 'stopped', 'spending_limit_reached'), 'Durdurulduharcama sınırı doldu'],
      [result(7, 'failed', 'card_not_runnable'), 'Hataajan kartı çalışmaya açık değil'],
      [result(8, 'failed', 'model_unavailable'), 'Hatamodel kullanılamadı'],
      // A code the list does not know: the word alone.
      [result(9, 'failed', 'runner_error'), 'Hata'],
      [result(10, 'completed', null), 'Tamamlandı'],
    ];
    mockApi(
      projectHandlers(projectDetail(), {
        [RUNS]: () => json(projectRuns(cases.map(([run]) => run))),
      }),
    );
    renderApp(TAB);
    const list = await table();
    const cells = rows(list).map((row) => within(row).getAllByRole('cell')[3]?.textContent);
    expect(cells).toEqual(cases.map(([, text]) => text));
    // No code of the runner is anywhere on the page.
    for (const [run] of cases) {
      if (run.errorCode !== null) expect(document.body).not.toHaveTextContent(run.errorCode);
    }
  });

  it('runs: an open run says Sürüyor instead of a duration', async () => {
    mockApi(projectHandlers(projectDetail(), { [RUNS]: () => json(projectRuns([open, done])) }));
    renderApp(TAB);
    const [first, second] = rows(await table()) as [HTMLElement, HTMLElement];
    const cellsOf = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    // The duration says it, and so does the result: the status language has one word for it.
    expect(cellsOf(first).slice(2, 4)).toEqual(['Sürüyor', 'Sürüyor']);
    expect(cellsOf(second).slice(2, 4)).toEqual(['38 sn.', 'Tamamlandı']);
  });

  it('runs: empty, error with retry and the cut-list sentence', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [RUNS]: () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      }),
    );
    renderApp(TAB);
    const panel = await tabPanel();
    expect(within(panel).getByText('Yükleniyor')).toBeInTheDocument();
    release(apiError(409, 'invalid_request', 'Çalışmalar şu anda okunamadı. Yeniden deneyin.'));
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent('Çalışmalar şu anda okunamadı. Yeniden deneyin.');

    // The first step when there is no run.
    api.handle(RUNS, () => json(projectRuns()));
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    expect(
      await within(panel).findByRole('heading', { name: 'Bu projede henüz ajan çalışması yok' }),
    ).toBeVisible();
    expect(panel).toHaveTextContent(
      'Bu projede bir talep açıldığında ajanların çalışmaları burada listelenir.',
    );
    expect(within(panel).queryByRole('table')).toBeNull();
    expect(within(panel).queryByRole('alert')).toBeNull();
    cleanup();

    // A list that was cut says so, and that the count is of all runs.
    mockApi(
      projectHandlers(projectDetail(), {
        [RUNS]: () =>
          json(
            projectRuns([done], {
              truncated: true,
              totals: { runCount: 412, usage: null },
            }),
          ),
      }),
    );
    renderApp(TAB);
    await table();
    const cut = await tabPanel();
    expect(cut).toHaveTextContent('Bu projede 412 ajan çalışması var.');
    expect(cut).toHaveTextContent(
      'Liste en yeni 200 çalışmayı gösteriyor; toplamlar bütün çalışmaları kapsar.',
    );
    cleanup();

    mockApi(projectHandlers(projectDetail(), { [RUNS]: () => json(projectRuns([done])) }));
    renderApp(TAB);
    await table();
    expect(await tabPanel()).not.toHaveTextContent('Liste en yeni 200 çalışmayı gösteriyor');
  });

  it('runs: the list refreshes in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = mockApi(
        projectHandlers(projectDetail(), { [RUNS]: () => json(projectRuns([open])) }),
      );
      renderApp(TAB);
      expect(rows(await table())).toHaveLength(1);
      expect(api.callsTo(RUNS)).toHaveLength(1);
      expect(api.callsTo(RUNS)[0]?.headers.get(BACKGROUND_HEADER)).toBeNull();

      // Runs move by themselves: every half minute, as a background request (rule 3).
      api.handle(RUNS, () =>
        json(
          projectRuns([
            projectRun({ ...open, status: 'completed', durationMs: 61_000 }),
            projectRun({ id: id(5) }),
          ]),
        ),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(api.callsTo(RUNS)).toHaveLength(2);
      });
      expect(api.callsTo(RUNS)[1]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      await waitFor(async () => {
        expect(rows(await table())).toHaveLength(2);
      });
      expect(await tabPanel()).toHaveTextContent('1 dk.');
      // The project itself is not read on a timer.
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs: the token breakdown is text a screen reader reads', async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        [RUNS]: () => json(projectRuns([projectRun({ usage: USAGE })])),
      }),
    );
    renderApp(TAB);
    const [row] = rows(await table()) as [HTMLElement];
    const tokens = within(row).getAllByRole('cell')[4];
    const breakdown = 'Girdi 5.200, çıktı 1.600, önbelleğe yazılan 300, önbellekten okunan 900';
    // The number, then the breakdown as text: no aria-label replaces the number.
    expect(tokens).toHaveTextContent(`8.000. ${breakdown}`);
    expect(tokens).not.toHaveAttribute('aria-label');
    expect(tokens).toHaveAttribute('title', breakdown);
    expect(within(tokens as HTMLElement).getByText(`. ${breakdown}`)).toHaveClass('sr-only');
  });
});
