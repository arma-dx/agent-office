import {
  COMPANY_HEADER,
  type CompanyAgentStatus,
  type MembershipSummary,
  type OfficeResponse,
} from '@agent-office/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeUnit } from './lib/office/model.ts';
import { WIDE_WINDOW_QUERY } from './lib/office/use-wide-window.ts';
import { PANEL_STORAGE_KEY } from './lib/shell.ts';
import { stubMatchMedia } from './test/match-media.ts';
import {
  apiError,
  ARMADX,
  FOUNDER_SPACE,
  json,
  mockApi,
  noContent,
  PILLIKA,
  sessionBody,
  sessionHandler,
} from './test/mock-api.ts';
import { ARMADX_OFFICE, FOUNDER_OFFICE, PILLIKA_OFFICE } from './test/office-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

/** The answer of GET /api/office for a pilot office; no company has a switch unless one is given. */
function officeBody(
  units: readonly OfficeUnit[],
  switches: Record<string, CompanyAgentStatus> = {},
): OfficeResponse {
  return {
    units: units.map((unit) => ({
      code: unit.code,
      name: unit.name,
      agents: unit.agents.map((agent) => ({
        code: agent.code,
        name: agent.name,
        status: switches[agent.code] ?? null,
      })),
    })),
  };
}

const EMPLOYEE: MembershipSummary = { ...ARMADX, role: 'employee', canApprove: false };
const EXTERNAL: MembershipSummary = { ...ARMADX, role: 'external', canApprove: false };
const REFUSAL = 'Ofis görünümü dış kişilere açık değil.';

function officeApi(body: OfficeResponse = officeBody(ARMADX_OFFICE)) {
  return mockApi({
    'GET /session': sessionHandler(),
    'GET /office': () => json(body),
  });
}

function desk(code: string): Element {
  const element = document.querySelector(`svg [data-office-id="agent:${code}"]`);
  if (!element) throw new Error(`no desk for ${code}`);
  return element;
}

/** A window of 1280 px or wider: the page asks for the properties panel while something is selected. */
function wideWindow() {
  return stubMatchMedia([WIDE_WINDOW_QUERY]);
}

function detailsPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Özellikler' });
}

/** The value shown beside a field name in the panel ("Kod", "Birim", "Durum", "Ajan sayısı"). */
function field(name: string): HTMLElement {
  const value = within(detailsPanel()).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${name}`);
  return value;
}

/** The names of the buttons in the panel's list of agents. */
function listedAgents(): (string | null)[] {
  return within(within(detailsPanel()).getByRole('list', { name: 'Ajanlar' }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
}

describe('office page', () => {
  it('asks for the office of the company in the address and draws it under one heading', async () => {
    const api = officeApi();
    renderApp('/c/armadx/office');
    expect(
      await screen.findByRole('figure', { name: 'Arma DX ofisi: 7 birim, 12 ajan' }),
    ).toBeInTheDocument();
    expect(api.callsTo('GET /office').map((call) => call.headers.get(COMPANY_HEADER))).toEqual([
      ARMADX.companyId,
    ]);
    expect(api.unexpected).toEqual([]);
    // The top bar names the page; the figure adds no heading of its own.
    expect(
      screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent),
    ).toEqual(['Ofis görünümü']);
    expect(screen.getByRole('link', { name: 'Ofis görünümü' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Every unit and agent of the answer is a button; nothing else is drawn.
    const list = screen.getByRole('list', { name: 'Birimler' });
    expect(within(list).getAllByRole('button')).toHaveLength(7 + 12);
    expect(document.querySelectorAll('svg g.office-unit')).toHaveLength(7);
    expect(document.querySelectorAll('svg g.office-agent')).toHaveLength(12);
    // Kurumsal Hafıza stands in the middle.
    expect(screen.getByRole('button', { name: 'Kurumsal Hafıza, HAF, 2 ajan' })).toBeVisible();
    // Nobody has opened an agent yet: one state, one legend row.
    expect(
      within(screen.getByRole('list', { name: 'Durumlar' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Kapalı']);
  });

  it('draws another company from its own answer, and Kurucu alanı under its panel name', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'PUT /session/company': () => noContent(),
      'GET /office': (call) =>
        json(
          call.headers.get(COMPANY_HEADER) === PILLIKA.companyId
            ? officeBody(PILLIKA_OFFICE)
            : officeBody(FOUNDER_OFFICE),
        ),
    });
    renderApp('/c/pillika/office');
    expect(
      await screen.findByRole('figure', { name: 'Pillika ofisi: 5 birim, 10 ajan' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^A-KES/ })).toBeNull();

    // The company menu keeps the page and changes the company.
    await userEvent.click(screen.getByRole('button', { name: /Şirket: Pillika/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Kurucu alanı' }));
    expect(
      await screen.findByRole('figure', { name: 'Kurucu alanı ofisi: 1 birim, 1 ajan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'KOR-4 Yönetici Asistanı, Koordinasyon Katmanı, Kapalı' }),
    ).toBeVisible();
    expect(api.callsTo('GET /office').map((call) => call.headers.get(COMPANY_HEADER))).toEqual([
      PILLIKA.companyId,
      FOUNDER_SPACE.companyId,
    ]);
  });

  it('says that it is loading while the request is open', async () => {
    let answer: ((response: Response) => void) | undefined;
    mockApi({
      'GET /session': sessionHandler(),
      'GET /office': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp('/c/armadx/office');
    // The page is in the shell and waits for its own request (the session has its own loading state).
    await waitFor(() => {
      expect(answer).toBeDefined();
    });
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('status')).toHaveTextContent('Yükleniyor');
    expect(screen.queryByRole('figure')).toBeNull();
    answer?.(json(officeBody(ARMADX_OFFICE)));
    expect(await screen.findByRole('figure')).toBeInTheDocument();
    expect(within(main).queryByRole('status')).toBeNull();
  });

  it('shows what went wrong with a retry, and the retry fetches again', async () => {
    let attempts = 0;
    const api = mockApi({
      'GET /session': sessionHandler(),
      // A refusal that is not retried by itself, so the test does not wait for the back-off.
      'GET /office': () => {
        attempts += 1;
        return attempts === 1
          ? apiError(
              429,
              'rate_limited',
              'Çok sık istek gönderildi. Biraz bekleyip yeniden deneyin.',
            )
          : json(officeBody(ARMADX_OFFICE));
      },
    });
    renderApp('/c/armadx/office');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Çok sık istek gönderildi. Biraz bekleyip yeniden deneyin.',
    );
    expect(screen.queryByRole('figure')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByRole('figure')).toBeInTheDocument();
    expect(api.callsTo('GET /office')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the first step when the company has no agent', async () => {
    officeApi({ units: [] });
    renderApp('/c/armadx/office');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Burada henüz ajan yok' }),
    ).toBeVisible();
    expect(screen.getByText('Ajanlar tanımlanınca birimleriyle burada görünür.')).toBeVisible();
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('refuses an external person on the page without asking the API', async () => {
    const api = mockApi({
      'GET /session': sessionHandler({ memberships: [EXTERNAL] }),
      'GET /office': () => json(officeBody(ARMADX_OFFICE)),
    });
    renderApp('/c/armadx/office');
    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL);
    expect(screen.queryByRole('figure')).toBeNull();
    expect(api.callsTo('GET /office')).toEqual([]);
    // The menu does not offer the page either; the address was typed by hand.
    expect(screen.queryByRole('link', { name: 'Ofis görünümü' })).toBeNull();
  });

  it('checks the session again when the API says the person became an external one', async () => {
    let membership = EMPLOYEE;
    const api = mockApi({
      'GET /session': () => json(sessionBody({ memberships: [membership] })),
      'GET /office': () => {
        // The founder changed this person's role after the panel loaded the session.
        membership = EXTERNAL;
        return apiError(403, 'insiders_only', 'Bu ekran dış kişilere açık değil.');
      },
    });
    renderApp('/c/armadx/office');
    expect(await screen.findByText(REFUSAL)).toBeVisible();
    expect(api.callsTo('GET /session')).toHaveLength(2);
    expect(api.callsTo('GET /office')).toHaveLength(1);
    // The fresh role takes the row out of the menu as well.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Ofis görünümü' })).toBeNull();
    });
    expect(screen.getByRole('link', { name: 'Ajanlar' })).toBeInTheDocument();
  });

  it('marks the chosen agent and clears the mark on a second click and on Escape', async () => {
    officeApi();
    renderApp('/c/armadx/office');
    const label = await screen.findByRole('button', { name: /^KOR-1 / });
    expect(label).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(label);
    expect(label).toHaveAttribute('aria-pressed', 'true');
    expect(desk('KOR-1')).toHaveAttribute('data-selected');
    expect(document.querySelectorAll('svg [data-selected]')).toHaveLength(1);

    await userEvent.click(label);
    expect(label).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('svg [data-selected]')).toBeNull();

    // A unit is chosen the same way; Escape clears it.
    const card = screen.getByRole('button', { name: 'Koordinasyon Katmanı, KOR, 4 ajan' });
    await userEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('svg [data-selected]')).toHaveAttribute(
      'data-office-id',
      'unit:KOR',
    );
    await userEvent.keyboard('{Escape}');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('svg [data-selected]')).toBeNull();
  });

  it('reads the switch of the company: enabled is "Etkin", stopped is "Durduruldu"', async () => {
    officeApi(
      officeBody(ARMADX_OFFICE, { 'KOR-1': 'enabled', 'HAF-1': 'stopped', 'HAF-2': 'disabled' }),
    );
    renderApp('/c/armadx/office');
    expect(
      await screen.findByRole('button', {
        name: 'KOR-1 Ofis Koordinatörü, Koordinasyon Katmanı, Etkin',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'HAF-1 Bilgi Tabanı Ajanı, Kurumsal Hafıza, Durduruldu' }),
    ).toBeVisible();
    // A row that says "disabled" and no row at all read the same.
    expect(
      screen.getByRole('button', { name: 'HAF-2 Kurumsal Arama Ajanı, Kurumsal Hafıza, Kapalı' }),
    ).toBeVisible();
    expect(desk('KOR-1')).toHaveAttribute('data-state', 'enabled');
    expect(desk('HAF-1')).toHaveAttribute('data-state', 'stopped');
    expect(desk('HAF-2')).toHaveAttribute('data-state', 'closed');
    expect(
      within(screen.getByRole('list', { name: 'Durumlar' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Kapalı', 'Etkin', 'Durduruldu']);
  });
});

describe('office page: the selection in the properties panel', () => {
  it('shows the chosen agent in the panel without touching the stored choice; Escape closes it', async () => {
    wideWindow();
    officeApi();
    renderApp('/c/armadx/office');
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();

    await userEvent.click(await screen.findByRole('button', { name: /^KOR-2 / }));
    const panel = detailsPanel();
    expect(panel).toBeVisible();
    // Under the shell's "Özellikler" (h2) the content starts with the full card name.
    expect(
      within(panel).getByRole('heading', { level: 3, name: 'Görev Takip Ajanı' }),
    ).toBeVisible();
    expect(field('Kod')).toHaveTextContent('KOR-2');
    expect(
      within(field('Birim')).getByRole('button', { name: 'Koordinasyon Katmanı' }),
    ).toBeVisible();
    expect(field('Durum')).toHaveTextContent('Kapalı');
    expect(within(panel).getByText('Bu ajan kapalı.')).toBeVisible();
    // Nothing the office does not know: three fields, one sentence, two buttons.
    expect(
      within(panel)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Kod', 'Birim', 'Durum']);
    expect(
      within(panel)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Koordinasyon Katmanı', 'Seçimi kaldır']);

    // The page asked for the panel: the person's choice is not written, and there is no toggle.
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    // The focus stayed on the label in the scene, so Escape clears the selection from there.
    expect(screen.getByRole('button', { name: /^KOR-2 / })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.getByRole('button', { name: /^KOR-2 / })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();
  });

  it('lists the agents of a chosen unit; a choice made in the panel moves the focus to the new heading', async () => {
    wideWindow();
    officeApi();
    renderApp('/c/armadx/office');
    const card = await screen.findByRole('button', { name: 'Koordinasyon Katmanı, KOR, 4 ajan' });
    await userEvent.click(card);
    const panel = detailsPanel();
    expect(
      within(panel).getByRole('heading', { level: 3, name: 'Koordinasyon Katmanı' }),
    ).toBeVisible();
    expect(field('Kod')).toHaveTextContent('KOR');
    expect(field('Ajan sayısı')).toHaveTextContent('4');
    expect(within(panel).getByRole('heading', { level: 4, name: 'Ajanlar' })).toBeVisible();
    expect(listedAgents()).toEqual([
      'KOR-1 Ofis Koordinatörü, Kapalı',
      'KOR-2 Görev Takip Ajanı, Kapalı',
      'KOR-3 Onay Masası Ajanı, Kapalı',
      'KOR-5 Toplantı Ajanı, Kapalı',
    ]);

    // What each element in the panel reads at the moment it takes the focus: that is what a
    // screen reader announces.
    const heard: (string | null)[] = [];
    panel.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLHeadingElement) heard.push(event.target.textContent);
    });

    // Choosing an agent in the list removes the list, and with it the pressed button.
    await userEvent.click(
      within(panel).getByRole('button', { name: 'KOR-3 Onay Masası Ajanı, Kapalı' }),
    );
    const label = screen.getByRole('button', {
      name: 'KOR-3 Onay Masası Ajanı, Koordinasyon Katmanı, Kapalı',
    });
    expect(label).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(desk('KOR-3')).toHaveAttribute('data-selected');
    const heading = within(panel).getByRole('heading', { level: 3, name: 'Onay Masası Ajanı' });
    expect(heading).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    // The heading already named the agent when the focus arrived, not the unit that was left.
    expect(heard).toEqual(['Onay Masası Ajanı']);

    // The unit of the agent leads back the same way.
    await userEvent.click(within(panel).getByRole('button', { name: 'Koordinasyon Katmanı' }));
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(panel).getByRole('heading', { level: 3, name: 'Koordinasyon Katmanı' }),
    ).toHaveFocus();
    expect(heard).toEqual(['Onay Masası Ajanı', 'Koordinasyon Katmanı']);

    // "Seçimi kaldır" closes the panel and hands the focus back to the thing in the scene.
    await userEvent.click(
      within(panel).getByRole('button', { name: 'KOR-3 Onay Masası Ajanı, Kapalı' }),
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Seçimi kaldır' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(document.querySelector('svg [data-selected]')).toBeNull();
    expect(label).toHaveAttribute('aria-pressed', 'false');
    expect(label).toHaveFocus();
  });

  it('reaches the panel with the Tab key after the scene and its zoom buttons', async () => {
    wideWindow();
    officeApi();
    renderApp('/c/armadx/office');
    const card = await screen.findByRole('button', { name: 'Kurumsal Hafıza, HAF, 2 ajan' });
    card.focus();
    await userEvent.keyboard('{Enter}');
    const stops: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      const element = document.activeElement;
      stops.push(element?.getAttribute('aria-label') ?? element?.textContent ?? '');
    }
    expect(stops).toEqual([
      'Yakınlaştır',
      'Uzaklaştır',
      'Ekrana sığdır',
      'HAF-1 Bilgi Tabanı Ajanı, Kapalı',
      'HAF-2 Kurumsal Arama Ajanı, Kapalı',
      'Seçimi kaldır',
    ]);
    // With the keyboard too the focus goes back to the scene.
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(card).toHaveFocus();
  });

  it('leaves the panel to the person in a window narrower than 1280 px', async () => {
    // The default of the test environment: no media query matches.
    officeApi();
    renderApp('/c/armadx/office');
    const label = await screen.findByRole('button', { name: /^KOR-1 / });
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();

    await userEvent.click(label);
    // The selection is marked, the panel stays closed, and the toggle is offered in the top bar.
    expect(label).toHaveAttribute('aria-pressed', 'true');
    expect(desk('KOR-1')).toHaveAttribute('data-selected');
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    const toggle = within(screen.getByRole('banner')).getByRole('button', {
      name: 'Özellikleri göster',
    });

    await userEvent.click(toggle);
    expect(
      within(detailsPanel()).getByRole('heading', { level: 3, name: 'Ofis Koordinatörü' }),
    ).toBeVisible();
    // Here the panel is the person's own choice, stored as on every other page.
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe('open');

    // Without a selection there is nothing to show: no panel and no toggle.
    await userEvent.click(within(detailsPanel()).getByRole('button', { name: 'Seçimi kaldır' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    expect(label).toHaveFocus();
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe('open');
  });

  it('follows the window when it crosses 1280 px with something selected', async () => {
    const media = wideWindow();
    officeApi();
    renderApp('/c/armadx/office');
    await userEvent.click(await screen.findByRole('button', { name: /^KOR-1 / }));
    expect(detailsPanel()).toBeVisible();

    act(() => {
      media.set(WIDE_WINDOW_QUERY, false);
    });
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Özellikleri göster' })).toBeInTheDocument();
    // The selection itself does not depend on the panel.
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      media.set(WIDE_WINDOW_QUERY, true);
    });
    expect(detailsPanel()).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
  });

  it('reads the switch in the panel: a stopped agent takes no new work', async () => {
    wideWindow();
    officeApi(officeBody(ARMADX_OFFICE, { 'KOR-1': 'enabled', 'HAF-1': 'stopped' }));
    renderApp('/c/armadx/office');
    await userEvent.click(await screen.findByRole('button', { name: /^HAF-1 / }));
    const panel = detailsPanel();
    expect(field('Durum')).toHaveTextContent('Durduruldu');
    expect(within(panel).getByText('Bu ajan durduruldu, yeni iş almaz.')).toBeVisible();

    // The list of its unit says the same word.
    await userEvent.click(within(panel).getByRole('button', { name: 'Kurumsal Hafıza' }));
    expect(listedAgents()).toEqual([
      'HAF-1 Bilgi Tabanı Ajanı, Durduruldu',
      'HAF-2 Kurumsal Arama Ajanı, Kapalı',
    ]);

    await userEvent.click(screen.getByRole('button', { name: /^KOR-1 / }));
    expect(field('Durum')).toHaveTextContent('Etkin');
    expect(within(panel).getByText('Bu ajan etkin.')).toBeVisible();
  });

  it('closes the panel when the selected thing is no longer in the answer', async () => {
    wideWindow();
    let body = officeBody(ARMADX_OFFICE);
    mockApi({
      'GET /session': sessionHandler(),
      'GET /office': () => json(body),
    });
    const { queryClient } = renderApp('/c/armadx/office');
    await userEvent.click(await screen.findByRole('button', { name: /^A-TEK-2 / }));
    expect(
      within(detailsPanel()).getByRole('heading', { level: 3, name: 'Teklif Ajanı' }),
    ).toBeVisible();

    // The card no longer names this company, and the definitions were synced again.
    body = officeBody(ARMADX_OFFICE.filter((unit) => unit.code !== 'A-TEK'));
    await act(() => queryClient.invalidateQueries());
    await screen.findByRole('figure', { name: 'Arma DX ofisi: 6 birim, 11 ajan' });
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(document.querySelector('svg [data-selected]')).toBeNull();
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
  });

  it('starts another company without the selection and without the panel', async () => {
    wideWindow();
    mockApi({
      'GET /session': sessionHandler(),
      'PUT /session/company': () => noContent(),
      'GET /office': (call) =>
        json(
          call.headers.get(COMPANY_HEADER) === PILLIKA.companyId
            ? officeBody(PILLIKA_OFFICE)
            : officeBody(ARMADX_OFFICE),
        ),
    });
    renderApp('/c/armadx/office');
    // KOR-1 has a desk in both companies.
    await userEvent.click(await screen.findByRole('button', { name: /^KOR-1 / }));
    expect(detailsPanel()).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Pillika' }));
    await screen.findByRole('figure', { name: 'Pillika ofisi: 5 birim, 10 ajan' });
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('office page: the scene beside the panel', () => {
  // jsdom has no layout. As in office-view.test.tsx the viewport, the cards and the labels get
  // their sizes here, and report() plays the resize observer after a change of the layout.
  const canvas = { width: 1040, height: 740 };
  const observers = new Set<() => void>();

  function report() {
    act(() => {
      for (const notify of observers) notify();
    });
  }

  function fakeSize(element: HTMLElement): { width: number; height: number } {
    if (element.classList.contains('office-viewport')) return canvas;
    if (element.classList.contains('office-card')) return { width: 216, height: 48 };
    if (element.classList.contains('office-label')) return { width: 150, height: 24 };
    return { width: 0, height: 0 };
  }

  beforeEach(() => {
    canvas.width = 1040;
    canvas.height = 740;
    observers.clear();
    for (const side of ['Width', 'Height'] as const) {
      const key = side === 'Width' ? 'width' : 'height';
      for (const box of ['client', 'offset'] as const) {
        vi.spyOn(HTMLElement.prototype, `${box}${side}`, 'get').mockImplementation(function (
          this: HTMLElement,
        ) {
          return fakeSize(this)[key];
        });
      }
    }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets = new Set<Element>();
        notify: () => void;
        constructor(callback: ResizeObserverCallback) {
          this.notify = () => {
            const entries = [...this.targets].map((target) => ({ target }));
            callback(entries as ResizeObserverEntry[], this);
          };
        }
        observe(target: Element) {
          this.targets.add(target);
          observers.add(this.notify);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
          observers.delete(this.notify);
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function zoom(): number {
    const map = screen.getByRole('group', { name: 'Ofis haritası' });
    return Number(map.style.getPropertyValue('--office-k'));
  }

  function transform(): string | null {
    return screen.getByTestId('office-world').getAttribute('transform');
  }

  it('keeps the size of the drawing when the panel opens, and fits again when it closes', async () => {
    wideWindow();
    officeApi();
    renderApp('/c/armadx/office');
    const label = await screen.findByRole('button', { name: /^SOS-2 / });
    report();
    // A 1280 x 800 window: the whole office at full size.
    expect(zoom()).toBe(1);
    const fitted = transform();

    // The desk on the right is chosen; the panel takes 320 px of the canvas.
    await userEvent.click(label);
    expect(detailsPanel()).toBeVisible();
    canvas.width = 720;
    report();
    // Fitted to 720 px the office would shrink and show codes instead of names. The zoom stays,
    // and the view moves just far enough to keep the chosen desk in sight.
    expect(zoom()).toBe(1);
    expect(transform()).not.toBe(fitted);

    await userEvent.click(within(detailsPanel()).getByRole('button', { name: 'Seçimi kaldır' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    canvas.width = 1040;
    report();
    expect(transform()).toBe(fitted);
  });

  it('brings a room chosen in the panel into view, and still fits again afterwards', async () => {
    wideWindow();
    officeApi();
    renderApp('/c/armadx/office');
    const label = await screen.findByRole('button', { name: /^HAF-1 / });
    report();
    const fitted = transform();

    // A desk in the middle of the office is in sight beside the panel as well: nothing moves.
    await userEvent.click(label);
    canvas.width = 720;
    report();
    expect(transform()).toBe(fitted);

    // Its room reaches further to the right than the desk, under the panel's edge. Chosen in the
    // panel, it is brought into the canvas; the zoom stays.
    await userEvent.click(within(detailsPanel()).getByRole('button', { name: 'Kurumsal Hafıza' }));
    expect(zoom()).toBe(1);
    expect(transform()).not.toBe(fitted);
    expect(
      within(detailsPanel()).getByRole('heading', { level: 3, name: 'Kurumsal Hafıza' }),
    ).toHaveFocus();

    // The scene moved the view, not the person: without the selection it is fitted again.
    await userEvent.click(within(detailsPanel()).getByRole('button', { name: 'Seçimi kaldır' }));
    canvas.width = 1040;
    report();
    expect(transform()).toBe(fitted);
  });

  it('fits the scene as usual in a narrower window, where the panel follows the person', async () => {
    localStorage.setItem(PANEL_STORAGE_KEY, 'open');
    canvas.width = 784;
    canvas.height = 640;
    officeApi();
    renderApp('/c/armadx/office');
    const label = await screen.findByRole('button', { name: /^SOS-2 / });
    report();
    const before = zoom();

    await userEvent.click(label);
    expect(detailsPanel()).toBeVisible();
    canvas.width = 464;
    report();
    expect(zoom()).toBeLessThan(before);
  });
});
