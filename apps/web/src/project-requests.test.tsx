import { BACKGROUND_HEADER, COMPANY_HEADER } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDay } from './lib/dates.ts';
import { clearDrafts } from './lib/drafts.ts';
import { apiError, ARMADX, json, mockApi, type Handler } from './test/mock-api.ts';
import {
  EMPLOYEE_AT_ARMADX,
  project,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  projectRequestsRoute,
  sessionAs,
} from './test/project-fixtures.ts';
import { FOUNDER, REQUEST_ID, requestDetail, summaryOf } from './test/request-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The page of a project has tabs (8 October 2026, decision 17): first "Talepler", the requests of
// the project in the list form of the Talepler screen, and last "Ayarlar", the description and
// the members; the tabs between them have test files of their own. The tab is in the address.

afterEach(() => {
  vi.unstubAllGlobals();
  clearDrafts();
  sessionStorage.clear();
});

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const SETTINGS = `${PATH}?tab=settings`;
const REQUESTS = projectRequestsRoute();
const IN_PROJECT = { id: PROJECT_ID, name: 'Depo otomasyonu' };

/** A project that takes requests: open, and agents may work in it. */
const OPEN = { aiAllowed: true, agentsMayWork: true, customer: null };

const waiting = requestDetail({ project: IN_PROJECT });
const working = requestDetail({
  id: '77777777-7777-4777-8777-777777777777',
  title: 'Kasım bülteni',
  status: 'in_progress',
  stage: 'working',
  turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
  waitingForMe: false,
  project: IN_PROJECT,
  dueDate: '2026-10-20',
});
const done = requestDetail({
  id: '99999999-9999-4999-8999-999999999999',
  title: 'Ekim duyurusu',
  status: 'done',
  stage: 'done',
  turn: { kind: 'none' },
  waitingForMe: false,
  project: IN_PROJECT,
});
const listOf =
  (...requests: ReturnType<typeof requestDetail>[]): Handler =>
  () =>
    json({ requests: requests.map(summaryOf), truncated: false });

const tabs = () => screen.findByRole('tablist', { name: 'Proje bölümleri' });
const tab = (name: string) => screen.getByRole('tab', { name });
const tabPanel = (name: string) => screen.getByRole('tabpanel', { name });

describe('projects: the tabs of a project', () => {
  it('page: the tabs, Talepler first and Ayarlar last; arrows move between them; the address keeps the tab', async () => {
    mockApi(projectHandlers(projectDetail({ status: 'completed', closed: true })));
    const { router } = renderApp(PATH);
    const list = await tabs();
    expect(
      within(list)
        .getAllByRole('tab')
        .map((item) => item.textContent),
    ).toEqual(['Talepler', 'Kilometre taşları', 'Ayarlar']);
    // Every link to a project opens "Talepler": the address names no tab.
    expect(tab('Talepler')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Ayarlar')).toHaveAttribute('aria-selected', 'false');
    expect(currentLocation(router).search).toEqual({});
    await within(tabPanel('Talepler')).findByRole('heading', {
      name: 'Bu projede henüz talep yok',
    });
    // The panel that is not selected is not in the document.
    expect(screen.queryByRole('heading', { name: 'Açıklama' })).toBeNull();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    // The header, the sentence about agents and the sentence of a closed project stand above the
    // tabs, on both.
    const above = () => {
      expect(screen.getByRole('heading', { level: 2, name: 'Depo otomasyonu' })).toBeVisible();
      expect(
        screen.getAllByText('Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.')[0],
      ).toBeVisible();
      expect(screen.getByText(/^Bu proje kapalı\. Yeniden açmak için/)).toBeVisible();
      expect(screen.getByRole('button', { name: 'Projeyi düzenle' })).toBeVisible();
    };
    above();

    // The tab list is one Tab stop; Right and Left move between the tabs and select.
    const before = router.history.length;
    tab('Talepler').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Kilometre taşları')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Kilometre taşları')).toHaveFocus();
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'milestones' } });
    });
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Ayarlar')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Ayarlar')).toHaveFocus();
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'settings' } });
    });
    expect(
      within(tabPanel('Ayarlar')).getByRole('heading', { level: 3, name: 'Açıklama' }),
    ).toBeVisible();
    expect(within(tabPanel('Ayarlar')).getByRole('region', { name: 'Üyeler 2' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Bu projede henüz talep yok' })).toBeNull();
    above();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Kilometre taşları')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Talepler')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Talepler')).toHaveFocus();
    await waitFor(() => {
      expect(currentLocation(router).search).toEqual({});
    });
    // Home and End go to the first and the last.
    await userEvent.keyboard('{End}');
    expect(tab('Ayarlar')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(tab('Talepler')).toHaveAttribute('aria-selected', 'true');
    // A click selects too, and the focus stays on the tab.
    await userEvent.click(tab('Ayarlar'));
    expect(tab('Ayarlar')).toHaveFocus();
    await waitFor(() => {
      expect(currentLocation(router).search).toEqual({ tab: 'settings' });
    });
    // Changing the tab replaces the address: Back leaves the project, not its tabs.
    expect(router.history.length).toBe(before);
    cleanup();

    // The address keeps "Ayarlar": it opens there again (a reload, a shared link).
    mockApi(projectHandlers());
    renderApp(SETTINGS);
    await tabs();
    expect(tab('Ayarlar')).toHaveAttribute('aria-selected', 'true');
    expect(within(tabPanel('Ayarlar')).getByRole('heading', { name: 'Açıklama' })).toBeVisible();
    cleanup();

    // A tab the page does not know opens "Talepler".
    mockApi(projectHandlers());
    renderApp(`${PATH}?tab=files`);
    await tabs();
    expect(tab('Talepler')).toHaveAttribute('aria-selected', 'true');
  });

  it('Talepler tab: asks for the requests of this project and shows the three groups without the project’s name', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(OPEN), { [REQUESTS]: listOf(working, waiting, done) }),
    );
    renderApp(PATH);
    await tabs();
    const panel = tabPanel('Talepler');
    const mine = await within(panel).findByRole('region', { name: 'Sizden beklenenler 1' });
    // One request of the list, for this project and this company, and nothing "only mine": a
    // project's members and the founder read all of its requests.
    const [call] = api.callsTo(REQUESTS);
    expect(call?.path).toBe(`/requests?project=${PROJECT_ID}`);
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(call?.headers.get(BACKGROUND_HEADER)).toBeNull();
    expect(api.callsTo('GET /requests')).toHaveLength(0);
    expect(within(panel).queryByRole('switch')).toBeNull();
    // The groups are sections of the page: their headings are one level under the tab's page.
    expect(within(mine).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Sizden beklenenler 1',
    );
    const running = within(panel).getByRole('region', { name: 'Sürenler 1' });
    const closed = within(panel).getByRole('region', { name: 'Bitenler 1' });
    // The row's sentence is the one of the Talepler screen, without the project: every row here
    // is of this project.
    expect(
      within(mine).getByRole('link', {
        name: 'LinkedIn için gönderi yaz, Onayınız bekleniyor, sıra sizde',
      }),
    ).toHaveAttribute('href', `/c/armadx/requests/${REQUEST_ID}`);
    const row = within(running).getByRole('listitem');
    expect(
      within(row).getByRole('link', {
        name: `Kasım bülteni, Ajan çalışıyor, sıra SOS-2, Son tarih: ${formatDay('2026-10-20')}`,
      }),
    ).toBeVisible();
    expect(within(closed).getByRole('listitem')).toHaveTextContent('Tamamlandı');
    expect(panel).not.toHaveTextContent(/Depo otomasyonu|proje /);
    // The row of a narrow column: the stage and the turn, no unit code and no time, and the due
    // day under the title, at every window width (the page shares the window with the panel).
    expect(row).toHaveTextContent('Ajan çalışıyor');
    expect(row).toHaveTextContent('SOS-2');
    expect(row.querySelector('time')).toBeNull();
    expect(row).not.toHaveTextContent(/SOS(?!-2)/);
    const day = within(row).getByText(`Son tarih: ${formatDay('2026-10-20')}`);
    expect(day.tagName).toBe('P');
    expect(day).not.toHaveClass('hidden');
    // The two columns: the stage, which gets the width of the wide row from 1280 px so that the
    // reason a request waits is not cut, and the turn, which keeps its width at every window
    // width.
    const [stage, turn, ...others] = row.querySelectorAll('span.truncate');
    expect(others).toEqual([]);
    expect(stage).toHaveTextContent('Ajan çalışıyor');
    expect(stage?.className.split(' ').filter((name) => /^(xl:)?w-/.test(name))).toEqual([
      'w-44',
      'xl:w-64',
    ]);
    expect(turn).toHaveTextContent('SOS-2');
    expect(turn).toHaveClass('w-24');
    expect(turn?.className).not.toMatch(/xl:/);
    // How many wait is said to a screen reader, as on the Talepler screen.
    expect(within(panel).getByText('1 talep sizden bekleniyor.')).toHaveClass('sr-only');
    // A row is a link: the only button of the tab opens a new request.
    expect(within(panel).queryAllByRole('combobox')).toEqual([]);
    expect(
      within(panel)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Bu projede talep aç']);
    expect(api.unexpected).toEqual([]);
  });

  it('Talepler tab: the first step when there is no request; a closed project and a project where agents may not work say why, in the founder’s words and in an employee’s, and offer no button', async () => {
    const FIRST_STEP =
      'Ajanlardan bu proje için bir iş istemek üzere talep açın. Talebi yalnızca proje üyeleri ve kurucu görür.';
    const CLOSED = 'Kapalı projede yeni talep açılmaz.';
    const NO_AI = 'Bu projede ajanlar çalışamadığı için talep açılamaz.';
    const empty = async () => {
      await tabs();
      const panel = tabPanel('Talepler');
      await within(panel).findByRole('heading', { name: 'Bu projede henüz talep yok' });
      return panel;
    };

    mockApi(projectHandlers(projectDetail(OPEN)));
    renderApp(PATH);
    let panel = await empty();
    expect(within(panel).getByText(FIRST_STEP)).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Bu projede talep aç' })).toBeVisible();
    cleanup();

    // Closed: no new request (decision 48), also when agents could work.
    mockApi(projectHandlers(projectDetail({ ...OPEN, status: 'cancelled', closed: true })));
    renderApp(PATH);
    panel = await empty();
    expect(within(panel).getByText(CLOSED)).toBeVisible();
    expect(panel).not.toHaveTextContent(FIRST_STEP);
    expect(within(panel).queryByRole('button')).toBeNull();
    cleanup();

    // Agents may not work: the founder is told where the permission is.
    mockApi(projectHandlers(projectDetail()));
    renderApp(PATH);
    panel = await empty();
    expect(
      within(panel).getByText(`${NO_AI} Yapay zekâ iznini özellikler panelinden açabilirsiniz.`),
    ).toBeVisible();
    expect(within(panel).queryByRole('button')).toBeNull();
    cleanup();

    // An employee is told who opens it.
    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PATH);
    panel = await empty();
    expect(within(panel).getByText(`${NO_AI} Yapay zekâ iznini kurucu açar.`)).toBeVisible();
    expect(panel).not.toHaveTextContent(/özellikler panelinden/);
    expect(within(panel).queryByRole('button')).toBeNull();
    cleanup();

    // With requests in the list the same sentence stands above them, and still no button: the
    // open requests of a closed project run on to their end and stay listed (decision 48).
    mockApi(
      projectHandlers(projectDetail({ ...OPEN, status: 'completed', closed: true }), {
        [REQUESTS]: listOf(working),
      }),
    );
    renderApp(PATH);
    await tabs();
    panel = tabPanel('Talepler');
    expect(await within(panel).findByRole('region', { name: 'Sürenler 1' })).toBeVisible();
    expect(within(panel).getByText(CLOSED)).toBeVisible();
    expect(within(panel).queryByRole('button')).toBeNull();
  });

  it('Talepler tab: Bu projede talep aç opens the form with the project chosen', async () => {
    const created = requestDetail({
      status: 'open',
      stage: 'routing',
      turn: { kind: 'agent', code: 'KOR-1', name: 'Ofis Koordinatörü' },
      waitingForMe: false,
      unit: null,
      agent: null,
      journey: [],
      approval: null,
      requester: FOUNDER,
      project: IN_PROJECT,
      text: 'Depo için duyuru yaz',
      actions: { cancel: true, stop: false, reroute: false },
    });
    const api = mockApi(
      projectHandlers(projectDetail(OPEN), {
        'GET /projects': () =>
          json({
            projects: [
              project(OPEN),
              project({ ...OPEN, id: 'a2222222-2222-4222-8222-222222222222', name: 'Lansman' }),
            ],
            truncated: false,
          }),
        [REQUESTS]: listOf(working),
        'POST /requests': () => json(created, 201),
        [`GET /requests/${REQUEST_ID}`]: () => json(created),
      }),
    );
    const { router } = renderApp(PATH);
    await tabs();
    const open = await within(tabPanel('Talepler')).findByRole('button', {
      name: 'Bu projede talep aç',
    });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    const field = within(dialog).getByRole('combobox', { name: 'Proje' });
    await waitFor(() => {
      expect(field).toBeEnabled();
    });
    // This project is chosen; another can still be chosen.
    expect(field).toHaveValue(PROJECT_ID);
    expect(
      within(field).getByRole<HTMLOptionElement>('option', { name: 'Depo otomasyonu' }).selected,
    ).toBe(true);
    expect(within(field).getByRole('option', { name: 'Lansman' })).toBeEnabled();
    expect(dialog).toHaveTextContent('yalnızca bu projenin üyeleri ve kurucu görebilir');
    // Closed without sending, the focus goes back to the button.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
    });
    await userEvent.click(open);
    const again = await screen.findByRole('dialog', { name: 'Yeni talep' });
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Ne istiyorsunuz?' }),
      'Depo için duyuru yaz',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'Talebi gönder' }));
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(`/c/armadx/requests/${REQUEST_ID}`);
    });
    expect(api.callsTo('POST /requests')[0]?.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      text: 'Depo için duyuru yaz',
      projectId: PROJECT_ID,
    });
    // The new request's page names the project and leads back to it.
    expect(await screen.findByRole('link', { name: 'Depo otomasyonu' })).toHaveAttribute(
      'href',
      PATH,
    );
    expect(api.unexpected).toEqual([]);
  });

  it('Talepler tab: loading, the error with a retry, the cut list, and a refresh in the background that is not counted as activity', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let release: (response: Response) => void = () => undefined;
      const api = mockApi(
        projectHandlers(projectDetail(OPEN), {
          [REQUESTS]: () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        }),
      );
      renderApp(PATH);
      await tabs();
      const panel = tabPanel('Talepler');
      // The project is on screen while its requests are read.
      expect(within(panel).getByText('Yükleniyor')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Depo otomasyonu' })).toBeVisible();
      release(apiError(409, 'invalid_request', 'Liste şu anda okunamadı. Yeniden deneyin.'));
      const alert = await within(panel).findByRole('alert');
      expect(alert).toHaveTextContent('Liste şu anda okunamadı. Yeniden deneyin.');
      api.handle(REQUESTS, () => json({ requests: [summaryOf(working)], truncated: true }));
      await user.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
      expect(await within(panel).findByRole('region', { name: 'Sürenler 1' })).toBeVisible();
      expect(within(panel).queryByRole('alert')).toBeNull();
      expect(within(panel).getByText('Liste en yeni 200 talebi gösteriyor.')).toBeVisible();

      // The list moves by itself: every half minute, as a background request (rule 3).
      const before = api.callsTo(REQUESTS).length;
      api.handle(REQUESTS, listOf(working, waiting));
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(api.callsTo(REQUESTS)).toHaveLength(before + 1);
      });
      expect(api.callsTo(REQUESTS).at(-1)?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      expect(api.callsTo(REQUESTS).at(-1)?.path).toBe(`/requests?project=${PROJECT_ID}`);
      expect(
        await within(panel).findByRole('region', { name: 'Sizden beklenenler 1' }),
      ).toBeVisible();
      expect(within(panel).queryByText('Liste en yeni 200 talebi gösteriyor.')).toBeNull();
      // The project itself is not read on a timer: it does not move by itself.
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
