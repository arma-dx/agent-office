import {
  COMPANY_HEADER,
  type CompanyAgentStatus,
  type MembershipSummary,
  type OfficeResponse,
} from '@agent-office/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { OfficeUnit } from './lib/office/model.ts';
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
    // A selection is a mark and nothing more: no properties panel and no toggle for one.
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();

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
