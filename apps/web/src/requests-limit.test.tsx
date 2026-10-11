import { startAuthentication } from '@simplewebauthn/browser';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts } from './lib/drafts.ts';
import {
  CAUSE_FOR_FOUNDER,
  CAUSE_NEXT,
  CAUSE_SENTENCE,
  CHANGES_HELD,
  CHANGES_HELD_BY_LIMIT,
  CHANGES_HELD_BY_LIMIT_FOR_REQUESTER,
  LIMIT_FOR_OTHERS,
  RESULT_HELD,
} from './lib/requests/labels.ts';
import { apiError, ARMADX, json, mockApi, sessionHandler, type Handler } from './test/mock-api.ts';
import { ASSERTION, stepUpIssuer } from './test/passkeys.ts';
import { project, PROJECT_ID } from './test/project-fixtures.ts';
import {
  APPROVAL_CARD,
  APPROVAL_ID,
  DEFAULT_JOURNEY,
  EMPLOYEE,
  PROJECT_REF,
  REQUEST_ID,
  RESULT,
  requestDetail,
} from './test/request-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

// A request inside a project whose AI spending limit is reached (8 October decision 17). The
// limit is about money, not about permission: a result that waits is approved, rejected and
// accepted as always, and only what calls for a new run is held. Raising the limit, which only
// the founder does, starts the held work again (11 October decision 1).

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDrafts();
  sessionStorage.clear();
});

const REQUEST_PAGE = `/c/armadx/requests/${REQUEST_ID}`;
const DECISION = `POST /approvals/${APPROVAL_ID}/decision`;
const ACCEPTANCE = `POST /requests/${REQUEST_ID}/acceptance`;

const EMPLOYEE_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};

/** The line under the title that says where the request is and whose turn it is, as one text. */
function stageLine(): string {
  const line = screen
    .getAllByRole('status')
    .find((element) => element.textContent.startsWith('Aşama'));
  if (!line) throw new Error('No stage line');
  return [...line.children].map((part) => part.textContent).join(' ');
}

/** A request of the project, held because the project's AI spending limit is reached. */
function heldRequest(overrides: Parameters<typeof requestDetail>[0] = {}) {
  return requestDetail({
    status: 'in_progress',
    stage: 'fell_to_person',
    cause: 'spending_limit_reached',
    turn: { kind: 'founder' },
    waitingForMe: true,
    project: PROJECT_REF,
    spendingLimitReached: true,
    approval: null,
    actions: { cancel: false, stop: true, reroute: false },
    ...overrides,
  });
}

const LIMIT_CARD = { ...APPROVAL_CARD, project: PROJECT_REF, spendingLimitReached: true };

describe('the page of a request whose project is at its spending limit', () => {
  it('a request held by the spending limit: the founder is told where to raise it and is linked to the Çalışmalar tab; a member is told who raises it', async () => {
    // The last run is not why the request waits: its words are not in the notice.
    const words = 'Kaynak verilmediği için sonuç sunamadım.';
    const journey = DEFAULT_JOURNEY.map((item, index) =>
      index === 2 && item.kind === 'run'
        ? { ...item, status: 'completed' as const, agentText: words }
        : item,
    );
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(heldRequest({ journey })),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(CAUSE_SENTENCE.spending_limit_reached)).toBeVisible();
    // The turn is the founder's: only the founder raises the limit.
    expect(stageLine()).toContain('Aşama: Sizden bekleniyor: harcama sınırı doldu Sıra: sizde');
    const notice = screen.getByText(CAUSE_SENTENCE.spending_limit_reached).closest('[role="note"]');
    if (!(notice instanceof HTMLElement)) throw new Error('No notice');
    expect(within(notice).getByText(CAUSE_FOR_FOUNDER.spending_limit_reached ?? '')).toBeVisible();
    // 11 October decision 1: raising the limit starts the work it stopped or refused by itself.
    // A request whose run had ended by itself is not started by a raise, and the sentence does
    // not promise it.
    expect(notice).toHaveTextContent(
      'Sınır yükselince yarıda durdurulan ya da başlatılamayan iş kendiliğinden yeniden başlar. Çalışması durdurulmadan bitmiş talep başlamaz; kendi nedeniyle insana düşer.',
    );
    expect(notice).not.toHaveTextContent('bekleyen iş kendiliğinden');
    expect(within(notice).getByRole('link', { name: 'Projeyi aç' })).toHaveAttribute(
      'href',
      `/c/armadx/projects/${PROJECT_ID}?tab=runs`,
    );
    // No way on but the limit: the routing cannot be corrected while it holds.
    expect(CAUSE_NEXT.spending_limit_reached).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Yönlendirmeyi düzelt|Sıradaki adımı/);
    expect(screen.getByRole('button', { name: 'İşi durdur' })).toBeVisible();
    expect(notice).not.toHaveTextContent(LIMIT_FOR_OTHERS);
    // The decider still reads the agent's words, in the journey, under the label that says
    // whose: they matter when deciding whether to raise the limit or stop the request.
    expect(notice).not.toHaveTextContent(words);
    expect(screen.getByRole('region', { name: 'Yolculuk' })).toHaveTextContent(words);
    cleanup();

    // The requester, an employee: who raises the limit, and nothing they cannot do or know.
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          heldRequest({
            waitingForMe: false,
            actions: { cancel: true, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(CAUSE_SENTENCE.spending_limit_reached)).toBeVisible();
    expect(stageLine()).toContain('Aşama: İnsana düştü: harcama sınırı doldu Sıra: Kurucu');
    expect(screen.getByText(LIMIT_FOR_OTHERS)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Projeyi aç' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /passkey|Yönlendirmeyi düzelt|Sıradaki adımı|Çalışmalar|\$/,
    );
    expect(screen.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible();
  });

  it('a waiting result while the limit is reached: Düzeltme iste is held with its sentence, Onayla and Reddet work', async () => {
    const approved = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: false,
      project: PROJECT_REF,
      spendingLimitReached: true,
      approval: null,
      result: RESULT,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({ project: PROJECT_REF, spendingLimitReached: true, approval: LIMIT_CARD }),
        ),
      'POST /step-up/options': stepUpIssuer().handler,
      [DECISION]: () => json(approved),
    });
    renderApp(REQUEST_PAGE);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(stageLine()).toContain('Aşama: Onayınız bekleniyor');
    expect(within(card).getByText(CHANGES_HELD_BY_LIMIT)).toBeVisible();
    // The permission's banner is not shown: the result is not held, only the change request.
    expect(card).not.toHaveTextContent(RESULT_HELD);
    expect(within(card).queryByRole('link', { name: 'Projeyi aç' })).toBeNull();

    const changes = within(card).getByRole('button', { name: 'Düzeltme iste' });
    expect(changes).toHaveAttribute('aria-disabled', 'true');
    expect(changes).toHaveAccessibleDescription(CHANGES_HELD_BY_LIMIT);
    await userEvent.click(changes);
    // Still focusable, and the keyboard's place is kept; nothing opens and nothing is sent.
    expect(changes).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo(DECISION)).toHaveLength(0);

    // "Onayla" is as always: only the missing choice keeps it back, and says so.
    const approve = within(card).getByRole('button', { name: 'Onayla' });
    expect(approve).toHaveAccessibleDescription('Onaylamak için önce bir seçenek seçin.');
    await userEvent.click(within(card).getByRole('radio', { name: /Seçenek B/ }));
    expect(approve).not.toHaveAttribute('aria-disabled');
    expect(approve).not.toHaveAccessibleDescription();
    // It asks for the passkey this card needs, as it does without a limit.
    await userEvent.click(approve);
    const passkey = await screen.findByRole('alertdialog', { name: 'Sonucu onayla' });
    await userEvent.click(within(passkey).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.callsTo(DECISION)).toHaveLength(0);

    // Rejecting closes the request and starts no agent: it works.
    const reject = within(card).getByRole('button', { name: 'Reddet' });
    expect(reject).not.toHaveAttribute('aria-disabled');
    expect(reject).not.toHaveAccessibleDescription();
    await userEvent.click(reject);
    const dialog = await screen.findByRole('dialog', { name: 'Sonucu reddet' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Neden' }), 'Eksik');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reddet' }));
    await waitFor(() => {
      expect(api.callsTo(DECISION).map((call) => call.body)).toEqual([
        { decision: 'rejected', reason: 'incomplete' },
      ]);
    });
    cleanup();

    // A card without a passkey: "Onayla" sends at once while the limit is reached.
    const plain = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            project: PROJECT_REF,
            spendingLimitReached: true,
            approval: { ...LIMIT_CARD, needsStepUp: false, options: [] },
          }),
        ),
      [DECISION]: () => json(approved),
    });
    renderApp(REQUEST_PAGE);
    const second = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    await userEvent.click(within(second).getByRole('button', { name: 'Onayla' }));
    await waitFor(() => {
      expect(plain.callsTo(DECISION).map((call) => call.body)).toEqual([{ decision: 'approved' }]);
    });
    cleanup();

    // When the permission holds the result too, its banner says everything: one reason is said.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            project: PROJECT_REF,
            agentsMayWork: false,
            spendingLimitReached: true,
            approval: { ...LIMIT_CARD, agentsMayWork: false },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    const both = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(both).toHaveTextContent(RESULT_HELD);
    expect(both).not.toHaveTextContent(CHANGES_HELD_BY_LIMIT);
    cleanup();

    // Without a reached limit nothing is held and nothing is said.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            project: PROJECT_REF,
            approval: { ...APPROVAL_CARD, project: PROJECT_REF },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    const free = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(free).not.toHaveTextContent(/harcama sınırı/);
    expect(within(free).getByRole('button', { name: 'Düzeltme iste' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('the requester’s card: İstediğim bu değil is held, Sonucu onayla works', async () => {
    const waiting = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: true,
      project: PROJECT_REF,
      spendingLimitReached: true,
      approval: null,
      result: RESULT,
      acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: false },
      actions: { cancel: true, stop: false, reroute: false },
    });
    const done = requestDetail({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
      project: PROJECT_REF,
      spendingLimitReached: true,
      approval: null,
      result: RESULT,
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(waiting),
      [ACCEPTANCE]: () => json(done),
    });
    renderApp(REQUEST_PAGE);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    expect(within(card).getByText(CHANGES_HELD_BY_LIMIT_FOR_REQUESTER)).toBeVisible();
    expect(card).not.toHaveTextContent(CHANGES_HELD);
    const notThis = within(card).getByRole('button', { name: 'İstediğim bu değil' });
    expect(notThis).toHaveAttribute('aria-disabled', 'true');
    expect(notThis).toHaveAccessibleDescription(CHANGES_HELD_BY_LIMIT_FOR_REQUESTER);
    await userEvent.click(notThis);
    expect(notThis).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo(ACCEPTANCE)).toHaveLength(0);
    // Accepting the approved result starts no agent: it works.
    const accept = within(card).getByRole('button', { name: 'Sonucu onayla' });
    expect(accept).not.toHaveAttribute('aria-disabled');
    expect(accept).not.toHaveAccessibleDescription();
    await userEvent.click(accept);
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Tamamlandı');
    });
    expect(api.callsTo(ACCEPTANCE).map((call) => call.body)).toEqual([{ decision: 'approved' }]);
    cleanup();

    // The same on Onaylar: each desk card carries its own flags.
    const acceptance = (
      flags: { agentsMayWork: boolean; spendingLimitReached: boolean },
      requestId: string,
      requestTitle: string,
    ) => ({
      requestId,
      requestTitle,
      round: 1,
      returnsToAgent: true,
      ...flags,
      forRequester: null,
      openedAt: '2026-10-07T09:00:00.000Z',
      result: RESULT,
    });
    const desk = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      'GET /approvals': () =>
        json({
          approvals: [],
          acceptances: [
            acceptance(
              { agentsMayWork: true, spendingLimitReached: true },
              REQUEST_ID,
              'Lansman duyurusu',
            ),
            // Both hold: the permission's sentence is the one that is said.
            acceptance(
              { agentsMayWork: false, spendingLimitReached: true },
              '77777777-7777-4777-8777-777777777777',
              'Kasım bülteni',
            ),
            acceptance(
              { agentsMayWork: true, spendingLimitReached: false },
              '88888888-8888-4888-8888-888888888888',
              'Aralık bülteni',
            ),
          ],
        }),
    });
    renderApp('/c/armadx/approvals');
    const results = await screen.findByRole('region', { name: 'Talep sahibi onayları 3' });
    const [atLimit, both, free] = within(results).getAllByRole('region', { name: 'Sonuç hazır' });
    if (!atLimit || !both || !free) throw new Error('Three acceptance cards were expected');
    expect(within(atLimit).getByText(CHANGES_HELD_BY_LIMIT_FOR_REQUESTER)).toBeVisible();
    const heldButton = within(atLimit).getByRole('button', { name: 'İstediğim bu değil' });
    expect(heldButton).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(heldButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(both).getByText(CHANGES_HELD)).toBeVisible();
    expect(both).not.toHaveTextContent(CHANGES_HELD_BY_LIMIT_FOR_REQUESTER);
    expect(free).not.toHaveTextContent(/düzeltme istenemez/);
    const freeButton = within(free).getByRole('button', { name: 'İstediğim bu değil' });
    expect(freeButton).not.toHaveAttribute('aria-disabled');
    await userEvent.click(freeButton);
    expect(await screen.findByRole('dialog', { name: 'İstediğim bu değil' })).toBeVisible();
    expect(desk.callsTo(ACCEPTANCE)).toHaveLength(0);
  });

  it('a run the limit stopped that did not start again reads its two sentences, with Yönlendirmeyi düzelt', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          heldRequest({
            cause: 'spending_limit_interrupted',
            spendingLimitReached: false,
            actions: { cancel: false, stop: true, reroute: true },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(CAUSE_SENTENCE.spending_limit_interrupted)).toBeVisible();
    expect(stageLine()).toContain('Aşama: Sizden bekleniyor: sınır dolunca durdu');
    expect(screen.getByText(CAUSE_NEXT.spending_limit_interrupted ?? '')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeVisible();
    // Not the notice of a limit that is still reached.
    expect(screen.queryByText(CAUSE_SENTENCE.spending_limit_reached)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Projeyi aç' })).toBeNull();
  });
});

describe('Yeni talep: a project at its spending limit', () => {
  const LANSMAN = project({
    id: PROJECT_ID,
    name: 'Lansman',
    aiAllowed: true,
    agentsMayWork: true,
    customer: null,
  });
  const AT_LIMIT = project({
    id: 'a2222222-2222-4222-8222-222222222222',
    name: 'Çağrı merkezi',
    aiAllowed: true,
    agentsMayWork: true,
    spendingLimitReached: true,
    customer: null,
  });
  const NO_AI = project({
    id: 'a3333333-3333-4333-8333-333333333333',
    name: 'Depo otomasyonu',
    aiAllowed: false,
    agentsMayWork: false,
  });
  const HELP =
    'İsteğe bağlı. Proje seçerseniz talebi yalnızca o projenin üyeleri ve kurucu görür, ajanlar da o projenin içinde çalışır. Proje, talep gönderildikten sonra değiştirilemez.';
  const LIMIT_HELP = 'Harcama sınırı dolan projede talep açılamaz.';
  const PERMISSION_HELP =
    'Ajanların çalışamadığı projede talep açılamaz. Yapay zekâ iznini projenin sayfasından açabilirsiniz.';

  const listOf =
    (...projects: ReturnType<typeof project>[]): Handler =>
    () =>
      json({ projects, truncated: false });
  const handlers = (projects: Handler, session: Handler = sessionHandler()) => ({
    'GET /session': session,
    'GET /requests': () => json({ requests: [], truncated: false }),
    'GET /requests?mine=true': () => json({ requests: [], truncated: false }),
    'GET /projects': projects,
  });
  async function openForm(): Promise<HTMLElement> {
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: /Henüz talep yok|Açık talebiniz yok/ });
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('button', {
        name: 'Yeni talep',
      }),
    );
    return screen.findByRole('dialog', { name: 'Yeni talep' });
  }
  async function projectField(dialog: HTMLElement): Promise<HTMLSelectElement> {
    const field = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Proje' });
    await waitFor(() => {
      expect(field).toBeEnabled();
    });
    return field;
  }

  it('the form offers a project at its limit disabled, with the reason and the help line', async () => {
    mockApi(handlers(listOf(AT_LIMIT, LANSMAN)));
    let dialog = await openForm();
    let field = await projectField(dialog);
    expect(
      within(field)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Proje yok', 'Çağrı merkezi (harcama sınırı doldu)', 'Lansman']);
    expect(
      within(field).getByRole('option', { name: 'Çağrı merkezi (harcama sınırı doldu)' }),
    ).toBeDisabled();
    expect(within(field).getByRole('option', { name: 'Lansman' })).toBeEnabled();
    // It cannot be chosen.
    await userEvent.selectOptions(field, AT_LIMIT.id).catch(() => undefined);
    expect(field).toHaveValue('');
    expect(field).toHaveAccessibleDescription(
      `${HELP} ${LIMIT_HELP} Sınırı projenin sayfasından yükseltebilirsiniz.`,
    );
    // No project is closed for its permission: that line is not shown.
    expect(dialog).not.toHaveTextContent('Ajanların çalışamadığı projede');
    cleanup();

    // An employee is told who raises it.
    mockApi(handlers(listOf(AT_LIMIT, LANSMAN), sessionHandler(EMPLOYEE_SESSION)));
    dialog = await openForm();
    field = await projectField(dialog);
    expect(field).toHaveAccessibleDescription(`${HELP} ${LIMIT_HELP} Sınırı kurucu yükseltir.`);
    expect(dialog).not.toHaveTextContent(/projenin sayfasından yükseltebilirsiniz/);
    cleanup();

    // Both kinds are offered: both lines, the permission's first.
    mockApi(handlers(listOf(AT_LIMIT, NO_AI, LANSMAN)));
    dialog = await openForm();
    field = await projectField(dialog);
    expect(field).toHaveAccessibleDescription(
      `${HELP} ${PERMISSION_HELP} ${LIMIT_HELP} Sınırı projenin sayfasından yükseltebilirsiniz.`,
    );
    cleanup();

    // Nothing offered is at its limit: the line is not shown.
    mockApi(handlers(listOf(LANSMAN)));
    dialog = await openForm();
    field = await projectField(dialog);
    expect(field).toHaveAccessibleDescription(HELP);
    expect(dialog).not.toHaveTextContent(LIMIT_HELP);
  });

  it('the form reads the projects again when the API says that the limit was reached meanwhile', async () => {
    const api = mockApi({
      ...handlers(listOf(LANSMAN)),
      'POST /requests': () =>
        apiError(
          409,
          'project_spending_limit_reached',
          'Bu projenin yapay zekâ harcama sınırı doldu; sınır yükseltilene kadar bu projede talep açılamaz.',
        ),
    });
    const dialog = await openForm();
    const field = await projectField(dialog);
    await userEvent.selectOptions(field, LANSMAN.id);
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Ne istiyorsunuz?' }),
      'Lansman duyurusu yaz',
    );
    // The limit was reached between the list and the send.
    api.handle('GET /projects', listOf({ ...LANSMAN, spendingLimitReached: true }));
    const before = api.callsTo('GET /projects').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    expect(
      await within(dialog).findByText(/harcama sınırı doldu; sınır yükseltilene/),
    ).toBeVisible();
    await waitFor(() => {
      expect(api.callsTo('GET /projects').length).toBeGreaterThan(before);
    });
    // The field then says so itself, and the text stays.
    expect(
      await within(dialog).findByRole('option', { name: 'Lansman (harcama sınırı doldu)' }),
    ).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Ne istiyorsunuz?' })).toHaveValue(
      'Lansman duyurusu yaz',
    );
  });
});
