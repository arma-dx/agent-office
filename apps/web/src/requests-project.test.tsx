import { startAuthentication } from '@simplewebauthn/browser';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CLOSED_FOR_OTHERS,
  CAUSE_FOR_FOUNDER,
  CAUSE_NEXT,
  CAUSE_SENTENCE,
  CHANGES_HELD,
  RESULT_HELD,
  RESULT_HELD_FOR_FOUNDER,
  RESULT_HELD_FOR_OTHERS,
} from './lib/requests/labels.ts';
import { clearDrafts } from './lib/drafts.ts';
import { ARMADX, json, mockApi, sessionHandler } from './test/mock-api.ts';
import { ASSERTION } from './test/passkeys.ts';
import { PROJECT_ID } from './test/project-fixtures.ts';
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

// The browser's passkey prompt: the person confirms, unless a test says otherwise.
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
});

// A request inside a project (8 October decisions 44 to 49): the page names the project, a closed
// AI permission holds the request and its result (rule 12), and every held control says why
// instead of sending a request the API would refuse.

afterEach(() => {
  vi.unstubAllGlobals();
  clearDrafts();
  sessionStorage.clear();
});

const PROJECT_PAGE = `/c/armadx/projects/${PROJECT_ID}`;
const REQUEST_PAGE = `/c/armadx/requests/${REQUEST_ID}`;
const DECISION = `POST /approvals/${APPROVAL_ID}/decision`;
const ACCEPTANCE = `POST /requests/${REQUEST_ID}/acceptance`;

/** The line under the title that says where the request is and whose turn it is, as one text. */
function stageLine(): string {
  const line = screen
    .getAllByRole('status')
    .find((element) => element.textContent.startsWith('Aşama'));
  if (!line) throw new Error('No stage line');
  return [...line.children].map((part) => part.textContent).join(' ');
}

const EMPLOYEE_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};
/** An employee with the approval right: decides results, opens no permission. */
const APPROVER_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: true }],
};

/** A request of the project, held because agents may not work there now. */
function heldRequest(overrides: Parameters<typeof requestDetail>[0] = {}) {
  return requestDetail({
    status: 'in_progress',
    stage: 'fell_to_person',
    cause: 'ai_permission_closed',
    turn: { kind: 'founder' },
    waitingForMe: true,
    project: PROJECT_REF,
    agentsMayWork: false,
    approval: null,
    actions: { cancel: false, stop: true, reroute: false },
    ...overrides,
  });
}

const HELD_CARD = { ...APPROVAL_CARD, project: PROJECT_REF, agentsMayWork: false };

describe('the page of a request inside a project', () => {
  it('page: the header links to the project', async () => {
    const api = mockApi({
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
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(stageLine()).toContain('Birim: Sosyal Medya Proje: Lansman');
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Lansman' })).toHaveAttribute(
      'href',
      PROJECT_PAGE,
    );
    // The card names the project in plain words: its link is the header's.
    expect(card).toHaveTextContent('Talep sahibi: Ayşe YılmazProje: Lansman');
    expect(within(card).queryByRole('link', { name: 'Lansman' })).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('page: a request without a project names none', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
    });
    renderApp(REQUEST_PAGE);
    await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/Proje:/);
  });

  it('page: a request held by a closed permission says so, to the founder with the way on and the link, to an employee with who opens it; Yönlendirmeyi düzelt is not offered', async () => {
    // The run the close stopped is not why the request waits: its words are not in the notice.
    const journey = DEFAULT_JOURNEY.map((item, index) =>
      index === 2 && item.kind === 'run'
        ? { ...item, status: 'stopped' as const, agentText: 'Yarım kalan taslak.' }
        : item,
    );
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(heldRequest({ journey })),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(CAUSE_SENTENCE.ai_permission_closed)).toBeVisible();
    // Held requests stay open on the founder's list, with their own cause (decision 47).
    expect(stageLine()).toContain('Aşama: Sizden bekleniyor: yapay zekâ izni kapalı Sıra: sizde');
    const notice = screen.getByText(CAUSE_SENTENCE.ai_permission_closed).closest('[role="note"]');
    if (!(notice instanceof HTMLElement)) throw new Error('No notice');
    expect(within(notice).getByText(CAUSE_FOR_FOUNDER.ai_permission_closed ?? '')).toBeVisible();
    expect(notice).toHaveTextContent('İzin açılınca bekleyen iş kendiliğinden yeniden başlar.');
    expect(within(notice).getByRole('link', { name: 'Projeyi aç' })).toHaveAttribute(
      'href',
      PROJECT_PAGE,
    );
    // No way on but the permission: the routing cannot be corrected while it holds.
    expect(screen.queryByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Yönlendirmeyi düzelt|Sıradaki adımı/);
    expect(screen.getByRole('button', { name: 'İşi durdur' })).toBeVisible();
    expect(notice).not.toHaveTextContent('Yarım kalan taslak.');
    expect(notice).not.toHaveTextContent(AI_CLOSED_FOR_OTHERS);
    // The decider still reads those words, in the journey, under the label that says whose.
    expect(screen.getByRole('region', { name: 'Yolculuk' })).toHaveTextContent(
      'Yarım kalan taslak.',
    );
    cleanup();

    // The requester, an employee: who opens the permission, and nothing they cannot do.
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
    expect(await screen.findByText(CAUSE_SENTENCE.ai_permission_closed)).toBeVisible();
    expect(stageLine()).toContain('Aşama: İnsana düştü: yapay zekâ izni kapalı Sıra: Kurucu');
    expect(screen.getByText(AI_CLOSED_FOR_OTHERS)).toBeVisible();
    expect(AI_CLOSED_FOR_OTHERS).toBe('Talep kayıtlı. Yapay zekâ iznini yalnızca kurucu açar.');
    expect(screen.queryByRole('link', { name: 'Projeyi aç' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /passkey|Yönlendirmeyi düzelt|Sıradaki adımı/,
    );
    expect(screen.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible();
  });

  it('approval card: held, Onayla and Düzeltme iste do nothing and say why; Reddet works', async () => {
    const rejected = requestDetail({
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'rejected',
      turn: { kind: 'none' },
      waitingForMe: false,
      project: PROJECT_REF,
      agentsMayWork: false,
      approval: null,
      closure: { by: null, reason: 'incomplete', note: null },
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(requestDetail({ project: PROJECT_REF, agentsMayWork: false, approval: HELD_CARD })),
      [DECISION]: () => json(rejected),
    });
    renderApp(REQUEST_PAGE);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    // The stage is still the approver's: the result is not hidden and not closed (decision 46).
    expect(stageLine()).toContain('Aşama: Onayınız bekleniyor');
    const why = `${RESULT_HELD} ${RESULT_HELD_FOR_FOUNDER}`;
    expect(within(card).getByText(why)).toBeVisible();
    expect(within(card).getByRole('link', { name: 'Projeyi aç' })).toHaveAttribute(
      'href',
      PROJECT_PAGE,
    );
    // The result can still be read.
    expect(within(card).getByText('İzmir ofisimiz açıldı.')).toBeVisible();
    // The hold is said, not the missing choice; choosing an option changes nothing.
    expect(within(card).queryByText('Onaylamak için önce bir seçenek seçin.')).toBeNull();
    await userEvent.click(within(card).getByRole('radio', { name: /Seçenek B/ }));
    for (const name of ['Onayla', 'Düzeltme iste']) {
      const button = within(card).getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(why);
      await userEvent.click(button);
      // Still focusable, and the keyboard's place is kept.
      expect(button).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    }
    expect(api.callsTo(DECISION)).toHaveLength(0);
    expect(api.callsTo('POST /step-up/options')).toHaveLength(0);
    // Rejecting closes the request and starts no agent: it works as always.
    const reject = within(card).getByRole('button', { name: 'Reddet' });
    expect(reject).not.toHaveAttribute('aria-disabled');
    expect(reject).not.toHaveAccessibleDescription();
    await userEvent.click(reject);
    const dialog = await screen.findByRole('dialog', { name: 'Sonucu reddet' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Neden' }), 'Eksik');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reddet' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İptal edildi: sonuç reddedildi');
    });
    expect(api.callsTo(DECISION).map((call) => call.body)).toEqual([
      { decision: 'rejected', reason: 'incomplete' },
    ]);
    cleanup();

    // The same card on Onaylar, for an approver who is not the founder: no way to open the
    // permission is promised, the link to the project stays.
    const desk = mockApi({
      'GET /session': sessionHandler(APPROVER_SESSION),
      'GET /approvals': () => json({ approvals: [HELD_CARD], acceptances: [] }),
    });
    renderApp('/c/armadx/approvals');
    const approvals = await screen.findByRole('region', { name: /Birim onayları/ });
    expect(within(approvals).getByText(RESULT_HELD)).toBeVisible();
    expect(approvals).not.toHaveTextContent(RESULT_HELD_FOR_FOUNDER);
    expect(approvals).toHaveTextContent('Proje: Lansman');
    expect(within(approvals).getByRole('link', { name: 'Projeyi aç' })).toHaveAttribute(
      'href',
      PROJECT_PAGE,
    );
    for (const name of ['Onayla', 'Düzeltme iste']) {
      const button = within(approvals).getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(RESULT_HELD);
      await userEvent.click(button);
      expect(button).toHaveFocus();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    }
    expect(desk.callsTo(DECISION)).toHaveLength(0);
    expect(within(approvals).getByRole('button', { name: 'Reddet' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('approval card: with the permission open nothing is held and nothing is said', async () => {
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
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(card).not.toHaveTextContent(/ajanlar şu an çalışamaz/);
    expect(within(card).queryByRole('link', { name: 'Projeyi aç' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Düzeltme iste' })).not.toHaveAttribute(
      'aria-disabled',
    );
    // Only the missing choice keeps "Onayla" back, and says so.
    expect(within(card).getByRole('button', { name: 'Onayla' })).toHaveAccessibleDescription(
      'Onaylamak için önce bir seçenek seçin.',
    );
  });

  it('acceptance card: held, İstediğim bu değil does nothing and says why; Sonucu onayla works', async () => {
    const waiting = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: true,
      project: PROJECT_REF,
      agentsMayWork: false,
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
      agentsMayWork: false,
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
    expect(within(card).getByText(CHANGES_HELD)).toBeVisible();
    const notThis = within(card).getByRole('button', { name: 'İstediğim bu değil' });
    expect(notThis).toHaveAttribute('aria-disabled', 'true');
    expect(notThis).toHaveAccessibleDescription(CHANGES_HELD);
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

    // The same on Onaylar: the desk card carries its own `agentsMayWork`.
    const acceptance = (agentsMayWork: boolean, requestId: string, requestTitle: string) => ({
      requestId,
      requestTitle,
      round: 1,
      returnsToAgent: true,
      agentsMayWork,
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
            acceptance(false, REQUEST_ID, 'Lansman duyurusu'),
            acceptance(true, '77777777-7777-4777-8777-777777777777', 'Kasım bülteni'),
          ],
        }),
    });
    renderApp('/c/armadx/approvals');
    const results = await screen.findByRole('region', { name: /Taleplerinizin sonuçları/ });
    const [held, free] = within(results).getAllByRole('region', { name: 'Sonuç hazır' });
    if (!held || !free) throw new Error('Two acceptance cards were expected');
    expect(within(held).getByText(CHANGES_HELD)).toBeVisible();
    const heldButton = within(held).getByRole('button', { name: 'İstediğim bu değil' });
    expect(heldButton).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(heldButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    // A result of a request where agents may work is asked about as always.
    expect(free).not.toHaveTextContent(CHANGES_HELD);
    const freeButton = within(free).getByRole('button', { name: 'İstediğim bu değil' });
    expect(freeButton).not.toHaveAttribute('aria-disabled');
    expect(freeButton).not.toHaveAccessibleDescription();
    await userEvent.click(freeButton);
    expect(await screen.findByRole('dialog', { name: 'İstediğim bu değil' })).toBeVisible();
    expect(desk.callsTo(ACCEPTANCE)).toHaveLength(0);
  });

  it('page: a held result says to a reader who cannot decide it that it cannot be approved until the permission is open; a reader who can decide gets the card instead, and with the permission open nobody gets the line', async () => {
    expect(RESULT_HELD_FOR_OTHERS).toBe(
      'Bu projede ajanlar şu an çalışamaz; izin açılana kadar sonuç onaylanamaz. Yapay zekâ iznini yalnızca kurucu açar.',
    );
    // The requester: the API gives the card to nobody who may not decide.
    const forRequester = (agentsMayWork: boolean) =>
      requestDetail({
        waitingForMe: false,
        project: PROJECT_REF,
        agentsMayWork,
        approval: null,
        actions: { cancel: true, stop: false, reroute: false },
      });
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(forRequester(false)),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(RESULT_HELD_FOR_OTHERS)).toBeVisible();
    expect(stageLine()).toContain('Aşama: Birim onayında Sıra: Kurucu');
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    cleanup();

    // Who may decide reads it in the card, once.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(requestDetail({ project: PROJECT_REF, agentsMayWork: false, approval: HELD_CARD })),
    });
    renderApp(REQUEST_PAGE);
    await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(screen.queryByText(RESULT_HELD_FOR_OTHERS)).toBeNull();
    cleanup();

    // With the permission open nothing is held.
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(forRequester(true)),
    });
    renderApp(REQUEST_PAGE);
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Birim onayında');
    });
    expect(screen.getByRole('main')).not.toHaveTextContent(/ajanlar şu an çalışamaz/);
  });

  it('page: a run the close stopped before any routing does not promise "the same agent"', async () => {
    // The coordinator's run was stopped by the close; the permission is open again and the work
    // did not start again. No unit and no agent were ever chosen.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'open',
            stage: 'fell_to_person',
            cause: 'ai_permission_interrupted',
            turn: { kind: 'founder' },
            waitingForMe: true,
            unit: null,
            agent: null,
            project: PROJECT_REF,
            approval: null,
            journey: [],
            actions: { cancel: false, stop: true, reroute: true },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    expect(
      await screen.findByText(
        'Ajan kapalıysa Ofis görünümünden açıldığında iş kendiliğinden başlar. Ajan açıksa "Yönlendirmeyi düzelt" ile işi yeniden verin.',
      ),
    ).toBeVisible();
    expect(CAUSE_NEXT.ai_permission_interrupted).not.toMatch(/aynı ajan/);
    expect(screen.getByRole('main')).not.toHaveTextContent(/aynı ajan/);
    expect(stageLine()).toContain('Aşama: Sizden bekleniyor: izin kapanınca durdu');
  });
});
