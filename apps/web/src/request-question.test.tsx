import { BACKGROUND_HEADER, COMPANY_HEADER } from '@agent-office/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, ARMADX, json, mockApi, sessionHandler, USER_ID } from './test/mock-api.ts';
import {
  AWAITING_REPLY,
  comment,
  DEFAULT_JOURNEY,
  EMPLOYEE,
  EMPLOYEE_ID,
  FOUNDER,
  openQuestion,
  PROJECT_REF,
  QUESTION_ID,
  QUESTION_TEXT,
  REQUEST_ID,
  requestDetail,
  withComments,
} from './test/request-fixtures.ts';
import { renderApp } from './test/render-app.tsx';
import { clearDrafts, draftKey } from './lib/drafts.ts';

// An agent's question on the page of its request (7 October decision 7; 12 October decisions 3
// and 4): the requester reads it and answers, the approver of the request and the founder read it,
// everybody else reads only that the request waits. Nothing is shown as sent before the API has
// stored it, and a text that is being typed is never taken from the person.

afterEach(() => {
  vi.unstubAllGlobals();
  // Also a draft that still waits to be written: it must not open in the next test's box.
  clearDrafts();
  sessionStorage.clear();
});

const PAGE = `/c/armadx/requests/${REQUEST_ID}`;
const GET = `GET /requests/${REQUEST_ID}`;
const POST = `POST /requests/${REQUEST_ID}/questions/${QUESTION_ID}/answer`;
const SECOND_ID = '88888888-8888-4888-8888-888888888882';
const POST_SECOND = `POST /requests/${REQUEST_ID}/questions/${SECOND_ID}/answer`;

const HEADING = 'Ajanın sorusu';
const LABEL = 'SOS-2 şunu sordu (ajanın yazdığı metin; onaydan geçmedi)';
const HELP =
  'Yanıtınız ajana gider ve ajan işine kendiliğinden devam eder. Gönderdikten sonra değiştirilemez. Yanıtı bu kutuya yazın: yorum olarak yazılan yanıtı ajan görmez. Sorudaki her maddeyi yanıtlayın: ajan eksik kalanı yeniden sormayabilir, elindekiyle çalışır. Soruyu ve yanıtı talep sahibi, birimin onaylayıcısı ve kurucu okur.';
const HELP_HELD =
  'Yanıtınız kaydedilir. Bu projede ajanlar şu an çalışamaz; iş, engel kalkınca kendiliğinden başlar. Gönderdikten sonra değiştirilemez. Yanıtı bu kutuya yazın: yorum olarak yazılan yanıtı ajan görmez. Sorudaki her maddeyi yanıtlayın: ajan eksik kalanı yeniden sormayabilir, elindekiyle çalışır. Soruyu ve yanıtı talep sahibi, birimin onaylayıcısı ve kurucu okur.';
const KEYS = 'En çok 10.000 karakter. Ctrl+Enter ile de gönderilir.';
const SENT_AGENT = 'Yanıtınız gönderildi. Ajan işine kendiliğinden devam ediyor.';
const GONE =
  'Bu soru kapandı ya da yanıtlandı. Yazdığınız metin aşağıda duruyor; gerekiyorsa kopyalayın.';
const NOT_YOURS =
  'Bu soruyu artık talep sahibi yanıtlıyor. Yazdığınız metin aşağıda duruyor; gerekiyorsa kopyalayın.';
const FOR_OTHERS =
  'Ajan talep sahibine bir soru sordu; yanıt gelince iş sürer. Soruyu ve yanıtı talep sahibi, birimin onaylayıcısı ve kurucu okur.';
const REQUESTER_WRITES =
  'Yanıtı talep sahibi Ayşe Yılmaz yazar. Yanıt gelince ajan işine kendiliğinden devam eder. Yanıt için süre sınırı ve hatırlatma yoktur.';
const FOUNDER_WRITES =
  'Yanıtı talep sahibinin yerine kurucu yazar. Yanıt gelince ajan işine kendiliğinden devam eder. Yanıt için süre sınırı ve hatırlatma yoktur.';
const MAY_REROUTE_OR_STOP =
  'Beklemek istemiyorsanız yönlendirmeyi düzeltebilir ya da işi durdurabilirsiniz; ikisi de soruyu kapatır.';
const MAY_STOP = 'Beklemek istemiyorsanız işi durdurabilirsiniz; durdurmak soruyu kapatır.';
const ARRIVED = 'Ajan bir soru sordu.';
const CLOSED_BY_API = 'Bu soru yanıtlanmış ya da kapanmış. Sayfayı yenileyin.';

const EMPLOYEE_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};
/** A colleague who reads the request and is neither its requester nor its approver. */
const COLLEAGUE_SESSION = {
  user: { id: '99999999-9999-4999-8999-999999999999', name: 'Mehmet Demir' },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};
/** An approver who is not a founder. */
const APPROVER_SESSION = {
  user: { id: '99999999-9999-4999-8999-999999999998', name: 'Zeynep Kaya' },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: true }],
};

type Overrides = Parameters<typeof requestDetail>[0];

/** The request waits for an answer; the default reader is its requester. */
const waiting = (overrides: Overrides = {}) =>
  requestDetail({ ...AWAITING_REPLY, question: openQuestion(), ...overrides });

/** The same request as the founder or the approver reads it: the question, and no box. */
const readOnly = (overrides: Overrides = {}) =>
  waiting({
    question: openQuestion({ mayAnswer: false }),
    waitingForMe: false,
    actions: { cancel: false, stop: true, reroute: true },
    ...overrides,
  });

/** The page the API answers an answer with: the agent that asked has the turn again. */
const answered = (overrides: Overrides = {}) =>
  requestDetail({
    status: 'in_progress',
    stage: 'working',
    turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
    waitingForMe: false,
    approval: null,
    actions: { cancel: true, stop: false, reroute: false },
    comments: withComments([]),
    ...overrides,
  });

const draftName = (userId: string = EMPLOYEE_ID) =>
  draftKey(userId, ARMADX.companyId, `answer.${REQUEST_ID}`);
const draftKept = (userId?: string): unknown =>
  JSON.parse(sessionStorage.getItem(draftName(userId)) ?? 'null');

function card(): HTMLElement {
  return screen.getByRole('region', { name: HEADING });
}

function box(): HTMLTextAreaElement {
  return within(card()).getByRole('textbox', { name: 'Yanıtınız' });
}

/** The line under the title that says where the request is and whose turn it is, as one text. */
function stageLine(): string {
  const line = screen
    .getAllByRole('status')
    .find((element) => element.textContent.startsWith('Aşama'));
  if (!line) throw new Error('No stage line');
  return [...line.children].map((part) => part.textContent).join(' ');
}

/** What the page says to a screen reader about a question that arrived while it was open. */
function arrivals(): string[] {
  return screen
    .getAllByRole('status')
    .map((element) => element.textContent)
    .filter((text) => text === ARRIVED);
}

/** Opens the page of the request as the given person (the requester unless said otherwise). */
async function openPage(
  detail: ReturnType<typeof requestDetail>,
  session: Parameters<typeof sessionHandler>[0] = EMPLOYEE_SESSION,
) {
  const api = mockApi({ 'GET /session': sessionHandler(session), [GET]: () => json(detail) });
  const app = renderApp(PAGE);
  await screen.findByRole('region', { name: 'Yolculuk' });
  return { api, ...app };
}

describe('an agent’s question on the page of its request', () => {
  it('the requester reads the question and answers it', async () => {
    const { api } = await openPage(waiting());
    expect(stageLine()).toContain('Aşama: Yanıtınız bekleniyor');
    expect(stageLine()).toContain('Sıra: sizde');
    // The card stands with the cards that wait for the reader: above the request text.
    const text = screen.getByRole('heading', { name: 'Talep' });
    expect(card().compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    // Who asked and when.
    const time = card().querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-10-07T09:05:00.000Z');
    expect(time?.parentElement?.textContent).toMatch(
      /^SOS-2 Sosyal İçerik Yazım Ajanı sordu, .+\.$/,
    );
    // The agent's words, under a label that says whose they are and that nobody approved them;
    // plain text with its line break, no markup.
    const label = within(card()).getByText(LABEL);
    expect(label.nextElementSibling?.textContent).toBe(QUESTION_TEXT);
    expect(label.nextElementSibling).toHaveAttribute('dir', 'auto');
    expect(card().querySelector('a, img')).toBeNull();
    // What the answer does, where it must be written and what a half answer costs.
    expect(within(card()).getByText(HELP)).toBeVisible();
    expect(box()).toHaveAccessibleDescription(`${HELP} ${KEYS}`);
    // The requester answers for their own request: no sentence about somebody's place.
    expect(card()).not.toHaveTextContent(/yerine siz yanıtlıyorsunuz/);
    // A page never moves the focus by itself.
    expect(card().contains(document.activeElement)).toBe(false);
    // Not said to a screen reader as news: the question was there when the page opened.
    expect(arrivals()).toEqual([]);

    let answer: (response: Response) => void = () => undefined;
    api.handle(
      POST,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    await userEvent.type(box(), 'İzmir ofisi için.');
    await waitFor(
      () => {
        expect(draftKept()).toEqual({ questionId: QUESTION_ID, text: 'İzmir ofisi için.' });
      },
      { timeout: 2000 },
    );
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    await waitFor(() => {
      expect(api.callsTo(POST)).toHaveLength(1);
    });
    // Not stored yet: nothing is shown as sent, and the text is still the person's.
    expect(screen.queryByText(SENT_AGENT)).toBeNull();
    expect(box()).toHaveValue('İzmir ofisi için.');
    expect(box()).toHaveAttribute('readonly');
    expect(box()).not.toBeDisabled();
    const sending = within(card()).getByRole('button', { name: 'Gönderiliyor' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    expect(sending).not.toBeDisabled();
    // A second press while it is being sent sends nothing.
    await userEvent.click(sending);
    expect(api.callsTo(POST)).toHaveLength(1);

    const [call] = api.callsTo(POST);
    // The text and nothing else: no field sets a status, names an agent or approves anything.
    expect(call?.body).toEqual({ answer: 'İzmir ofisi için.' });
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    // A person's act: it counts as activity (rule 3).
    expect(call?.headers.get(BACKGROUND_HEADER)).toBeNull();

    const counts = api.callsTo('GET /today/counts').length;
    answer(json(answered()));
    const notice = await screen.findByText(SENT_AGENT);
    expect(notice.closest('[role="status"]')).not.toBeNull();
    // The button the person pressed is gone with the card: the focus is on the notice that took
    // its place, not at the top of the page.
    expect(notice.closest('[tabindex="-1"]')).toHaveFocus();
    expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Yanıtınız' })).toBeNull();
    expect(stageLine()).toContain('Aşama: Ajan çalışıyor');
    expect(sessionStorage.getItem(draftName())).toBeNull();
    // The Bugün row and its count go away with the answer: the sidebar reads its numbers again.
    await waitFor(() => {
      expect(api.callsTo('GET /today/counts').length).toBeGreaterThan(counts);
    });
    expect(api.unexpected).toEqual([]);
  });

  it('says what the answer did when the work is held, and when the turn is nobody’s machine', async () => {
    const { api } = await openPage(waiting());
    // The agent was stopped meanwhile: the answer is stored and the request falls to a person.
    api.handle(POST, () =>
      json(
        answered({
          stage: 'fell_to_person',
          cause: 'agent_stopped',
          turn: { kind: 'founder' },
        }),
      ),
    );
    await userEvent.type(box(), 'İzmir.');
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    expect(
      await screen.findByText(
        'Yanıtınız kaydedildi. İş şu an başlamadı; nedeni bu sayfada yazıyor.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(SENT_AGENT)).toBeNull();
    cleanup();

    // The request was cancelled in the instant after the answer: nothing is promised.
    const again = await openPage(waiting());
    again.api.handle(POST, () =>
      json(
        answered({
          status: 'cancelled',
          stage: 'cancelled',
          cause: 'stopped',
          turn: { kind: 'none' },
          actions: { cancel: false, stop: false, reroute: false },
        }),
      ),
    );
    await userEvent.type(box(), 'İzmir.');
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    const notice = await screen.findByText('Yanıtınız gönderildi.');
    expect(notice.closest('[tabindex="-1"]')).toHaveFocus();
  });

  it('an empty and a too long answer are said and not sent', async () => {
    const { api } = await openPage(waiting());
    api.handle(POST, () => json(answered()));
    // Nothing written: said at the box, nothing sent.
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    expect(within(card()).getByRole('alert')).toHaveTextContent('Yanıt yazın.');
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveAccessibleDescription(expect.stringContaining('Yanıt yazın.') as string);
    await userEvent.type(box(), '   ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(within(card()).getByRole('alert')).toHaveTextContent('Yanıt yazın.');
    // Too long: the limit is said, nothing is sent and nothing is cut; exactly the limit has no
    // problem.
    fireEvent.change(box(), { target: { value: 'a'.repeat(10_001) } });
    expect(within(card()).getByRole('alert')).toHaveTextContent(
      'Yanıt en çok 10.000 karakter olabilir.',
    );
    expect(box().value).toHaveLength(10_001);
    expect(box()).not.toHaveAttribute('maxlength');
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    fireEvent.change(box(), { target: { value: 'a'.repeat(10_000) } });
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(api.callsTo(POST)).toHaveLength(0);
  });

  it('the send key sends', async () => {
    const { api } = await openPage(waiting());
    api.handle(POST, () => json(answered()));
    // Enter alone writes a new line.
    await userEvent.type(box(), 'İzmir için.{Enter}Ankara sonra.');
    expect(box()).toHaveValue('İzmir için.\nAnkara sonra.');
    expect(api.callsTo(POST)).toHaveLength(0);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText(SENT_AGENT)).toBeVisible();
    expect(api.callsTo(POST).map((call) => call.body)).toEqual([
      { answer: 'İzmir için.\nAnkara sonra.' },
    ]);
  });

  it('keeps the text and says why when the send fails for a reason the page does not explain', async () => {
    const { api } = await openPage(waiting());
    const refusal = 'Beklenmeyen bir hata oluştu. Biraz sonra yeniden deneyin.';
    api.handle(POST, () => apiError(500, 'internal_error', refusal));
    await userEvent.type(box(), 'İzmir.');
    const before = api.callsTo(GET).length;
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      `Yanıt gönderilemedi. ${refusal}`,
    );
    expect(box()).toHaveValue('İzmir.');
    expect(box()).not.toHaveAttribute('readonly');
    // Nothing says that the page is out of date: it is not read again.
    expect(api.callsTo(GET)).toHaveLength(before);
    // A changed text is a new try: the reason the last one failed is no longer shown.
    await userEvent.type(box(), ' Ankara değil.');
    expect(within(card()).queryByRole('alert')).toBeNull();
  });

  it('the approver and the founder read the question and get no box', async () => {
    // The founder; the requester reads the request and answers.
    await openPage(readOnly(), {});
    expect(stageLine()).toContain('Aşama: Yanıt bekliyor');
    expect(stageLine()).toContain('Sıra: Ayşe Yılmaz');
    expect(within(card()).getByText(LABEL).nextElementSibling?.textContent).toBe(QUESTION_TEXT);
    expect(within(card()).getByText(REQUESTER_WRITES)).toBeVisible();
    // What they can do instead of waiting: the two acts of the page's header.
    expect(within(card()).getByText(MAY_REROUTE_OR_STOP)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'İşi durdur' })).toBeVisible();
    // No control in the card: nothing to type into and nothing to press.
    expect(within(card()).queryByRole('textbox')).toBeNull();
    expect(within(card()).queryByRole('button')).toBeNull();
    expect(card()).not.toHaveTextContent('Yanıtınız');
    cleanup();

    // The routing is held (a closed AI permission, a reached limit): stopping is what is left.
    await openPage(readOnly({ actions: { cancel: false, stop: true, reroute: false } }), {});
    expect(within(card()).getByText(REQUESTER_WRITES)).toBeVisible();
    expect(within(card()).getByText(MAY_STOP)).toBeVisible();
    expect(within(card()).queryByText(MAY_REROUTE_OR_STOP)).toBeNull();
    cleanup();

    // Neither act is offered: the card promises none.
    await openPage(
      readOnly({ actions: { cancel: false, stop: false, reroute: false } }),
      APPROVER_SESSION,
    );
    expect(within(card()).getByText(REQUESTER_WRITES)).toBeVisible();
    expect(card()).not.toHaveTextContent(/Beklemek istemiyorsanız/);
  });

  it('the founder who answers in the requester’s place is told in whose place', async () => {
    const inPlace =
      'Bu soruyu talep sahibi Ayşe Yılmaz yerine siz yanıtlıyorsunuz: talep sahibi talebi artık göremiyor.';
    const standsIn: Overrides = {
      question: openQuestion({ inPlaceOfRequester: true }),
      requesterReads: false,
      turn: { kind: 'founder' },
      actions: { cancel: false, stop: true, reroute: true },
    };
    const { api } = await openPage(waiting(standsIn), {});
    expect(stageLine()).toContain('Aşama: Yanıtınız bekleniyor');
    expect(stageLine()).toContain('Sıra: sizde');
    expect(within(card()).getByText(inPlace)).toBeVisible();
    // Read with the box: a screen reader hears in whose place before what the answer does.
    expect(box()).toHaveAccessibleDescription(`${inPlace} ${HELP} ${KEYS}`);
    // The banner above says the same of the whole request, and names the question.
    expect(
      screen.getByText(
        'Talep sahibi bu talebi artık göremiyor. Talep sürer: ajan kurucunun adına çalışır; ajanın sorusunu talep sahibinin yerine kurucu yanıtlar, sonucu da kurucu onaylar.',
      ),
    ).toBeVisible();
    // What is sent is the same: the API and the database decide who may answer.
    api.handle(POST, () => json(answered({ requesterReads: false })));
    await userEvent.type(box(), 'İzmir.');
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    expect(await screen.findByText(SENT_AGENT)).toBeVisible();
    expect(api.callsTo(POST)[0]?.body).toEqual({ answer: 'İzmir.' });
    cleanup();

    // A requester who left the company has no name any more: the sentence names nobody.
    await openPage(waiting({ ...standsIn, requester: { ...EMPLOYEE, name: null } }), {});
    expect(
      within(card()).getByText(
        'Bu soruyu talep sahibinin yerine siz yanıtlıyorsunuz: talep sahibi talebi artık göremiyor.',
      ),
    ).toBeVisible();
  });

  it('an approver is told that the founder answers while the requester cannot read the request', async () => {
    await openPage(
      readOnly({ requesterReads: false, turn: { kind: 'founder' } }),
      APPROVER_SESSION,
    );
    expect(stageLine()).toContain('Sıra: Kurucu');
    expect(within(card()).getByText(FOUNDER_WRITES)).toBeVisible();
    expect(card()).not.toHaveTextContent(/Yanıtı talep sahibi .* yazar/);
    expect(within(card()).queryByRole('textbox')).toBeNull();
  });

  it('another reader of the request sees that it waits for an answer and no text of the question', async () => {
    // The API gives this reader no question: the stage alone says that one waits.
    const hidden = waiting({
      question: null,
      waitingForMe: false,
      actions: { cancel: false, stop: false, reroute: false },
      comments: withComments([], false),
    });
    await openPage(hidden, COLLEAGUE_SESSION);
    expect(stageLine()).toContain('Aşama: Yanıt bekliyor');
    expect(stageLine()).toContain('Sıra: Ayşe Yılmaz');
    expect(screen.getByText(FOR_OTHERS)).toBeVisible();
    expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Yanıtınız' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('hangi ofisin');
    expect(document.body.innerHTML).not.toContain('şunu sordu');
    cleanup();

    // A request that waits for no answer shows nothing of a question.
    await openPage(answered(), COLLEAGUE_SESSION);
    expect(screen.queryByText(FOR_OTHERS)).toBeNull();
    expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
  });

  it('in a project where agents cannot work the box says that the answer is stored and the work starts later', async () => {
    // Rule 12: the AI permission of the request's project is closed.
    await openPage(waiting({ project: PROJECT_REF, agentsMayWork: false }));
    expect(within(card()).getByText(HELP_HELD)).toBeVisible();
    expect(box()).toHaveAccessibleDescription(`${HELP_HELD} ${KEYS}`);
    expect(document.body).not.toHaveTextContent('kendiliğinden devam eder');
    cleanup();

    // 8 October decision 17: the AI spending limit of the project is reached.
    await openPage(waiting({ project: PROJECT_REF, spendingLimitReached: true }));
    expect(within(card()).getByText(HELP_HELD)).toBeVisible();
    expect(document.body).not.toHaveTextContent('kendiliğinden devam eder');
  });

  it('a refresh does not touch what is being typed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { api } = await openPage(waiting());
      await user.type(box(), 'Yarım bir yanıt');
      // The caret is inside the text, with a selection.
      box().setSelectionRange(3, 8);
      const typed = box();
      // Somebody comments meanwhile: the next refresh brings another page with the same question.
      api.handle(GET, () => json(waiting({ comments: withComments([comment()]) })));
      const before = api.callsTo(GET).length;
      await vi.advanceTimersByTimeAsync(30_100);
      expect(await screen.findByRole('heading', { name: 'Yorumlar 1' })).toBeVisible();
      expect(api.callsTo(GET).length).toBeGreaterThan(before);
      // The same box (never mounted anew), its text, its selection and the focus.
      expect(box()).toBe(typed);
      expect(typed).toHaveValue('Yarım bir yanıt');
      expect(typed).toHaveFocus();
      expect([typed.selectionStart, typed.selectionEnd]).toEqual([3, 8]);
      expect(typed).not.toHaveAttribute('readonly');
      // The same question is not news.
      expect(arrivals()).toEqual([]);
      // The timer's request is a background request: it does not extend the idle time.
      expect(api.callsTo(GET).at(-1)?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      expect(api.unexpected).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a question that goes away leaves the text read-only with Taslağı at, and that button leaves Taslak atıldı. with the focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { api } = await openPage(waiting());
      await user.type(box(), 'Yarım kalan yanıt');
      const typed = box();
      typed.setSelectionRange(3, 8);
      // The routing is corrected meanwhile: the question is closed and the new agent works.
      api.handle(GET, () => json(answered()));
      await vi.advanceTimersByTimeAsync(30_100);
      expect(await within(card()).findByText(GONE)).toBeVisible();
      expect(within(card()).getByText(GONE)).toHaveAttribute('role', 'status');
      // The refresh took nothing from the person who was typing: the same box, the focus in it
      // and the caret where it was.
      expect(box()).toBe(typed);
      expect(typed).toHaveFocus();
      expect([typed.selectionStart, typed.selectionEnd]).toEqual([3, 8]);
      // The text is still there to be copied, and cannot be sent or changed.
      expect(typed).toHaveValue('Yarım kalan yanıt');
      expect(typed).toHaveAttribute('readonly');
      expect(typed).toHaveAttribute('aria-invalid', 'false');
      expect(typed).toHaveAccessibleDescription(GONE);
      expect(within(card()).queryByRole('button', { name: 'Yanıtı gönder' })).toBeNull();
      // The question's own text is gone with the question.
      expect(card()).not.toHaveTextContent('şunu sordu');
      await user.type(typed, ' daha');
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(typed).toHaveValue('Yarım kalan yanıt');
      expect(within(card()).queryByRole('alert')).toBeNull();
      expect(api.callsTo(POST)).toEqual([]);

      // With the keyboard: the next stop after the box is "Taslağı at". It removes the box and
      // itself; the focus goes to the sentence that takes their place.
      await user.tab();
      expect(within(card()).getByRole('button', { name: 'Taslağı at' })).toHaveFocus();
      await user.keyboard('{Enter}');
      const discarded = screen.getByText('Taslak atıldı.');
      expect(discarded).toBeVisible();
      expect(discarded).toHaveFocus();
      expect(discarded).toHaveAttribute('role', 'status');
      expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
      expect(screen.queryByRole('textbox', { name: 'Yanıtınız' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Taslağı at' })).toBeNull();
      expect(sessionStorage.getItem(draftName())).toBeNull();
      // The sentence does not take the focus again on a later refresh.
      const elsewhere = within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole(
        'link',
        { name: 'Talepler' },
      );
      elsewhere.focus();
      await vi.advanceTimersByTimeAsync(5_100);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(elsewhere).toHaveFocus();
      expect(screen.getByText('Taslak atıldı.')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a question that goes away under the send button moves the focus to the sentence that says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { api } = await openPage(waiting());
      await user.type(box(), 'Yarım kalan yanıt');
      await user.tab();
      expect(within(card()).getByRole('button', { name: 'Yanıtı gönder' })).toHaveFocus();
      api.handle(GET, () => json(answered()));
      await vi.advanceTimersByTimeAsync(30_100);
      // The button is gone with the question: the focus is not left at the top of the page.
      expect(await within(card()).findByText(GONE)).toHaveFocus();
      expect(box()).toHaveValue('Yarım kalan yanıt');
    } finally {
      vi.useRealTimers();
    }
  });

  it('409 question_closed: the API’s sentence is shown, the page is read again and the text stays', async () => {
    const { api } = await openPage(waiting());
    await userEvent.type(box(), 'Yarım kalan yanıt');
    // The page on screen is older than the API's: the question was closed meanwhile.
    api.handle(POST, () => apiError(409, 'question_closed', CLOSED_BY_API));
    let read: (response: Response) => void = () => undefined;
    api.handle(
      GET,
      () =>
        new Promise<Response>((resolve) => {
          read = resolve;
        }),
    );
    const before = api.callsTo(GET).length;
    await userEvent.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      `Yanıt gönderilemedi. ${CLOSED_BY_API}`,
    );
    await waitFor(() => {
      expect(api.callsTo(GET)).toHaveLength(before + 1);
    });
    // The page as it is now: no question. The text stays, read-only, with what happened.
    read(json(answered()));
    expect(await within(card()).findByText(GONE)).toBeVisible();
    expect(box()).toHaveValue('Yarım kalan yanıt');
    expect(box()).toHaveAttribute('readonly');
    expect(within(card()).queryByRole('button', { name: 'Yanıtı gönder' })).toBeNull();
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(within(card()).getByRole('button', { name: 'Taslağı at' })).toBeVisible();
    // The button that was pressed is gone: the focus is on the sentence, not on the page.
    expect(within(card()).getByText(GONE)).toHaveFocus();
    expect(screen.queryByText(SENT_AGENT)).toBeNull();
    expect(api.callsTo(POST)).toHaveLength(1);
  });

  it('a typed answer stays when the reader is no longer the one who answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      // The founder stands in for a requester who cannot read the request, and types.
      const { api } = await openPage(
        waiting({
          question: openQuestion({ inPlaceOfRequester: true }),
          requesterReads: false,
          turn: { kind: 'founder' },
          actions: { cancel: false, stop: true, reroute: true },
        }),
        {},
      );
      await user.type(box(), 'Kurucunun yarım yanıtı');
      const typed = box();
      // The requester is given the request back meanwhile: the same question, theirs to answer.
      api.handle(GET, () => json(readOnly()));
      await vi.advanceTimersByTimeAsync(30_100);
      expect(await within(card()).findByText(NOT_YOURS)).toBeVisible();
      // The read card: the question, who answers, what the founder can do.
      expect(within(card()).getByText(LABEL).nextElementSibling?.textContent).toBe(QUESTION_TEXT);
      expect(within(card()).getByText(REQUESTER_WRITES)).toBeVisible();
      expect(within(card()).getByText(MAY_REROUTE_OR_STOP)).toBeVisible();
      // Under it the text, neither thrown away nor hidden; nothing can be sent from it.
      expect(box()).toBe(typed);
      expect(typed).toHaveFocus();
      expect(typed).toHaveValue('Kurucunun yarım yanıtı');
      expect(typed).toHaveAttribute('readonly');
      expect(typed).toHaveAccessibleDescription(NOT_YOURS);
      expect(within(card()).queryByRole('button', { name: 'Yanıtı gönder' })).toBeNull();
      expect(card()).not.toHaveTextContent(/yerine siz yanıtlıyorsunuz/);
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(api.callsTo(POST)).toEqual([]);
      await user.click(within(card()).getByRole('button', { name: 'Taslağı at' }));
      const discarded = within(card()).getByText('Taslak atıldı.');
      expect(discarded).toHaveFocus();
      // The read card stays: the question still waits for the requester.
      expect(within(card()).getByText(REQUESTER_WRITES)).toBeVisible();
      expect(within(card()).queryByRole('textbox')).toBeNull();
      expect(sessionStorage.getItem(draftName(USER_ID))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the draft belongs to its question', async () => {
    await openPage(waiting());
    await userEvent.type(box(), 'Yarım kalan yanıt');
    await waitFor(
      () => {
        expect(draftKept()).toEqual({ questionId: QUESTION_ID, text: 'Yarım kalan yanıt' });
      },
      { timeout: 2000 },
    );
    // A draft of this person, this company and this request, in the tab's storage only.
    expect(draftName()).toBe(
      `agent-office.draft.${EMPLOYEE_ID}.${ARMADX.companyId}.answer.${REQUEST_ID}`,
    );
    const kept = Array.from({ length: localStorage.length }, (_, index) => {
      const name = localStorage.key(index) ?? '';
      return `${name}=${localStorage.getItem(name) ?? ''}`;
    });
    expect(kept.filter((entry) => /draft|Yarım kalan yanıt/.test(entry))).toEqual([]);
    cleanup();

    // Mounted anew (the page was loaded again): the text is back under the same question.
    await openPage(waiting());
    expect(box()).toHaveValue('Yarım kalan yanıt');
    cleanup();

    // Another question is open: the earlier one is settled, and its text is stale.
    await openPage(waiting({ question: openQuestion({ id: SECOND_ID }) }));
    expect(box()).toHaveValue('');
    await waitFor(() => {
      expect(sessionStorage.getItem(draftName())).toBeNull();
    });
    // An emptied box leaves no draft behind either.
    await userEvent.type(box(), 'x{Backspace}');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(sessionStorage.getItem(draftName())).toBeNull();
  });

  it('two questions in a row on one open page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const KOR_1 = { code: 'KOR-1', name: 'Ofis Koordinatörü' };
      const routing: Overrides = {
        status: 'open',
        stage: 'routing',
        turn: { kind: 'agent', ...KOR_1 },
        unit: null,
        agent: null,
      };
      // The coordinator asks before it routes (12 October decision 4).
      const first = waiting({
        unit: null,
        agent: null,
        question: openQuestion({ agent: KOR_1, text: 'Metin nerede yayınlanacak?' }),
      });
      const { api } = await openPage(first);
      api.handle(POST, () => json(answered(routing)));
      await user.type(box(), 'LinkedIn.');
      await user.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
      const sent = await screen.findByText(SENT_AGENT);
      expect(sent.closest('[tabindex="-1"]')).toHaveFocus();
      expect(arrivals()).toEqual([]);

      // The coordinator runs again and asks its second question: the next refresh brings it.
      api.handle(GET, () =>
        json(
          waiting({
            unit: null,
            agent: null,
            question: openQuestion({
              id: SECOND_ID,
              agent: KOR_1,
              text: 'Şirket sayfası için mi?',
            }),
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(5_100);
      expect(await within(card()).findByText('Şirket sayfası için mi?')).toBeVisible();
      // Said once to a screen reader; the notice of the first answer does not stand under it.
      expect(arrivals()).toEqual([ARRIVED]);
      expect(screen.queryByText(SENT_AGENT)).toBeNull();
      // A clean box: neither the first answer nor a problem of the first question.
      expect(box()).toHaveValue('');
      expect(within(card()).queryByRole('alert')).toBeNull();

      api.handle(POST_SECOND, () => json(answered(routing)));
      await user.type(box(), 'Evet.');
      await user.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
      // The notice takes the focus again: it is kept per question, not per page.
      const again = await screen.findByText(SENT_AGENT);
      expect(again.closest('[tabindex="-1"]')).toHaveFocus();
      expect(api.callsTo(POST).map((call) => call.body)).toEqual([{ answer: 'LinkedIn.' }]);
      expect(api.callsTo(POST_SECOND).map((call) => call.body)).toEqual([{ answer: 'Evet.' }]);
      // The second question is settled: nothing is said as news any more.
      expect(arrivals()).toEqual([]);
      expect(api.unexpected).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not offer an answered question again when an older page arrives after the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { api } = await openPage(waiting());
      api.handle(POST, () => json(answered()));
      await user.type(box(), 'İzmir.');
      await user.click(within(card()).getByRole('button', { name: 'Yanıtı gönder' }));
      expect(await screen.findByText(SENT_AGENT)).toBeVisible();
      // A refresh answers with the page as it was read before the answer was stored.
      const before = api.callsTo(GET).length;
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => {
        expect(api.callsTo(GET).length).toBeGreaterThan(before);
      });
      expect(screen.queryByRole('textbox', { name: 'Yanıtınız' })).toBeNull();
      expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
      expect(screen.getByText('Yanıtınız gönderildi.')).toBeVisible();
      expect(arrivals()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('an agent’s question in the journey of its request', () => {
  const KOR_1 = { code: 'KOR-1', name: 'Ofis Koordinatörü' };
  const SOS_2 = { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' };
  const [KOR_RUN, ROUTING, SOS_RUN] = DEFAULT_JOURNEY;
  if (!KOR_RUN || !ROUTING || !SOS_RUN || SOS_RUN.kind !== 'run') throw new Error('No journey');
  /** The run that ended with a question: the runner's fixed sentence, and no tool call row. */
  const ASKING_RUN = {
    ...SOS_RUN,
    summary: 'Ajan talep sahibine bir soru sordu ve çalışmasını bitirdi.',
    steps: [],
  };
  const CLOSED = 'Soru yanıtlanmadan kapandı: talep yeniden yönlendirildi ya da kapatıldı.';

  type QuestionItem = Extract<(typeof DEFAULT_JOURNEY)[number], { kind: 'question' }>;
  const item = (overrides: Partial<QuestionItem>): QuestionItem => ({
    kind: 'question',
    id: QUESTION_ID,
    at: '2026-10-07T09:05:00.000Z',
    agent: SOS_2,
    status: 'open',
    text: QUESTION_TEXT,
    answer: null,
    answeredAt: null,
    answeredBy: null,
    answeredInPlace: false,
    closedAt: null,
    ...overrides,
  });

  function rows(): HTMLElement[] {
    return within(screen.getByRole('region', { name: 'Yolculuk' })).getAllByRole('listitem');
  }

  function rowWith(text: string): HTMLElement {
    const row = rows().find((candidate) => candidate.textContent.includes(text));
    if (!row) throw new Error(`No journey row with: ${text}`);
    return row;
  }

  it('the journey shows an answered question with both texts, an answer in the requester’s place and a question closed without one; an open one without its text', async () => {
    const journey = [
      KOR_RUN,
      // The coordinator asked twice before it routed; the requester answered the first.
      item({
        id: '88888888-8888-4888-8888-888888888891',
        agent: KOR_1,
        status: 'answered',
        text: 'Metin nerede yayınlanacak?',
        answer: 'LinkedIn.\nŞirket sayfasında.',
        answeredAt: '2026-10-07T09:10:00.000Z',
        answeredBy: EMPLOYEE,
      }),
      // The founder routed the request by hand meanwhile: the second was closed without an answer.
      item({
        id: '88888888-8888-4888-8888-888888888892',
        at: '2026-10-07T09:12:00.000Z',
        agent: KOR_1,
        status: 'closed',
        text: 'Şirket sayfası için mi?',
        closedAt: '2026-10-07T09:20:00.000Z',
      }),
      ROUTING,
      ASKING_RUN,
      // The requester could not read the request any more: the founder answered in their place.
      item({
        id: '88888888-8888-4888-8888-888888888893',
        at: '2026-10-07T09:30:00.000Z',
        status: 'answered',
        answer: 'İzmir.',
        answeredAt: '2026-10-07T09:40:00.000Z',
        answeredBy: FOUNDER,
        answeredInPlace: true,
      }),
    ];
    // The founder reads; the agent works on with the answers.
    await openPage(
      answered({ journey, actions: { cancel: false, stop: true, reroute: true } }),
      {},
    );

    const first = rowWith('Metin nerede yayınlanacak?');
    expect(first).toHaveTextContent('KOR-1 talep sahibine sordu:');
    // The agent's words under the label that says whose they are; plain text.
    const label = within(first).getByText(
      'KOR-1 şunu sordu (ajanın yazdığı metin; onaydan geçmedi)',
    );
    expect(label.nextElementSibling?.textContent).toBe('Metin nerede yayınlanacak?');
    // Who answered and when, then the person's own words with their line break.
    expect(first.textContent).toMatch(/Ayşe Yılmaz yanıtladı, .+:/);
    expect(first.querySelector('time[datetime="2026-10-07T09:10:00.000Z"]')).not.toBeNull();
    const answer = within(first).getByText(/^LinkedIn\./);
    expect(answer.textContent).toBe('LinkedIn.\nŞirket sayfasında.');
    expect(answer).toHaveAttribute('dir', 'auto');
    expect(first).not.toHaveTextContent('talep sahibinin yerine');
    expect(first.querySelector('a, img')).toBeNull();
    // An event of the record, not a status that still waits.
    expect(first.querySelector('[data-journey-mark="event"]')).not.toBeNull();

    const second = rowWith('Şirket sayfası için mi?');
    expect(second).toHaveTextContent('KOR-1 talep sahibine sordu:');
    expect(within(second).getByText(CLOSED)).toBeVisible();
    expect(second).not.toHaveTextContent('yanıtladı');
    expect(second.querySelector('[data-journey-mark="event"]')).not.toBeNull();

    // Never "the requester answered" for an answer somebody else gave.
    const third = rowWith('İzmir.');
    expect(third).toHaveTextContent('SOS-2 talep sahibine sordu:');
    expect(third.textContent).toMatch(/Ömer Kadıoğlu, talep sahibinin yerine yanıtladı, .+:/);
    expect(within(third).getByText('İzmir.')).toBeVisible();
    expect(third).not.toHaveTextContent(CLOSED);

    // In the order the API gave: each question after the run that asked it.
    const texts = rows().map((row) => row.textContent);
    const at = (text: string) => texts.findIndex((row) => row.includes(text));
    expect(at('Metin nerede yayınlanacak?')).toBeLessThan(at('Şirket sayfası için mi?'));
    expect(at('Şirket sayfası için mi?')).toBeLessThan(
      at('Koordinasyon merkezi talebi yönlendirdi'),
    );
    expect(at('bir soru sordu ve çalışmasını bitirdi')).toBeLessThan(at('İzmir.'));
    cleanup();

    // Open: the text is in the card at the top of the page and is not said twice.
    await openPage(waiting({ journey: [KOR_RUN, ROUTING, ASKING_RUN, item({})] }));
    const open = rowWith('yanıt bekleniyor');
    expect(open).toHaveTextContent('SOS-2 talep sahibine bir soru sordu; yanıt bekleniyor.');
    expect(open).not.toHaveTextContent('hangi ofisin');
    expect(screen.getByRole('region', { name: 'Yolculuk' })).not.toHaveTextContent('hangi ofisin');
    expect(within(card()).getByText(LABEL).nextElementSibling?.textContent).toBe(QUESTION_TEXT);
    // The sign of "Yanıt bekliyor", as in the header; the words beside it say what it is.
    expect(open.querySelector('[data-journey-mark="event"]')).toBeNull();
    expect(open.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // The run that asked is a run like every other, with the runner's fixed sentence.
    expect(rowWith('bir soru sordu ve çalışmasını bitirdi')).toHaveTextContent('SOS-2');
  });

  it('a reader who is given no question reads the run’s fixed sentence and nothing of the texts', async () => {
    // The API cuts the question items for this reader; the journey draws what it was given.
    await openPage(
      waiting({
        question: null,
        waitingForMe: false,
        journey: [KOR_RUN, ROUTING, ASKING_RUN],
        actions: { cancel: false, stop: false, reroute: false },
        comments: withComments([], false),
      }),
      COLLEAGUE_SESSION,
    );
    expect(rows()).toHaveLength(4);
    expect(rowWith('bir soru sordu ve çalışmasını bitirdi')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Yolculuk' })).not.toHaveTextContent(
      /talep sahibine sordu|yanıt bekleniyor|yanıtladı/,
    );
  });
});
