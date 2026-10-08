import { COMPANY_HEADER, BACKGROUND_HEADER } from '@agent-office/shared';
import { focusManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  ARMADX,
  json,
  mockApi,
  noContent,
  PILLIKA,
  sessionHandler,
  USER_ID,
} from './test/mock-api.ts';
import {
  APPROVAL_CARD,
  APPROVAL_ID,
  DEFAULT_JOURNEY,
  EMPLOYEE,
  FOUNDER,
  REQUEST_ID,
  RESULT,
  requestDetail,
  summaryOf,
} from './test/request-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// Flow (A) in the panel: the form that asks one thing, the list that says where every request is
// and whose turn it is, the page with the journey, and the two decisions. The panel sets no status
// and offers no control that would; everything on screen is what the API answered.

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

/** The line under the title that says where the request is and whose turn it is, as one text. */
function stageLine(): string {
  const line = screen
    .getAllByRole('status')
    .find((element) => element.textContent.startsWith('Aşama'));
  if (!line) throw new Error('No stage line');
  return [...line.children].map((part) => part.textContent).join(' ');
}

function sidebarButton(): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('button', {
    name: 'Yeni talep',
  });
}

const EMPLOYEE_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};

describe('Yeni talep', () => {
  it('asks only what is wanted, sends the text with an id and opens the new request', async () => {
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
      actions: { cancel: true, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'POST /requests': () => json(created, 201),
      [`GET /requests/${REQUEST_ID}`]: () => json(created),
    });
    const { router } = renderApp('/c/armadx/requests');
    expect(await screen.findByRole('heading', { name: 'Henüz talep yok' })).toBeVisible();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('button', {
        name: 'Yeni talep',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    // One box, and no control that would choose a unit, an agent or an approver.
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    // What the form says before anything is sent: where the text goes and who will be able to
    // read the request. It tells and does not warn: personal and customer data may be written
    // (8 October decision 5), so nothing in the form says what not to write.
    const notice = within(dialog).getByText(/yapay zekâ modeline gönderilir/);
    expect(notice.textContent).toBe(
      'Talep metni yapay zekâ modeline gönderilir. Talebi ve onaylanan sonucunu şirketteki kurucu ve çalışanlar görebilir.',
    );
    expect(dialog).not.toHaveTextContent(/yazmayın|kişisel veri|müşteri/i);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByText(/koordinasyon merkezi yönlendirir/)).toBeVisible();
    expect(api.callsTo('GET /requests/intake')).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Ne istediğinizi yazın.');
    expect(api.callsTo('POST /requests')).toHaveLength(0);

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Ne istiyorsunuz?' }),
      'LinkedIn için gönderi yaz',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(`/c/armadx/requests/${REQUEST_ID}`);
    });
    const [call] = api.callsTo('POST /requests');
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(call?.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      text: 'LinkedIn için gönderi yaz',
    });
    // The page is the confirmation.
    expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible();
    expect(api.unexpected).toEqual([]);
  });

  it('keeps the text and says so when the API refuses', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'POST /requests': () =>
        apiError(
          500,
          'internal_error',
          'Beklenmeyen bir hata oluştu. Biraz sonra yeniden deneyin.',
        ),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Henüz talep yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    const box = within(dialog).getByRole('textbox');
    await userEvent.type(box, 'Bir gönderi');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    expect(await within(dialog).findByText(/Beklenmeyen bir hata/)).toBeVisible();
    expect(box).toHaveValue('Bir gönderi');
  });

  it('says so and sends nothing while a request could not run for this person', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      'GET /requests?mine=true': () => json({ requests: [], truncated: false }),
      'GET /requests/intake': () => json({ open: false, reason: 'trial_founder_only' }),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Açık talebiniz yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Ajanlar deneme aşamasında; şimdilik yalnızca kurucunun talepleri çalışır.',
    );
    const send = within(dialog).getByRole('button', { name: 'Talebi gönder' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).toHaveAccessibleDescription(/deneme aşamasında/);
    await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
    await userEvent.click(send);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(api.callsTo('POST /requests')).toHaveLength(0);
    // The text is not lost: it stays in the box.
    expect(within(dialog).getByRole('textbox')).toHaveValue('Bir gönderi yaz');
  });

  it('tells the founder what to do when the coordinator is closed', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'GET /requests/intake': () => json({ open: false, reason: 'coordinator_closed' }),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Henüz talep yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Koordinasyon merkezi bu şirkette açık değil; şu an talep gönderilemez. Ofis görünümünde KOR-1 ajanını açın.',
    );
  });

  it('gives the focus back to the button that opened it', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Henüz talep yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox')).toHaveFocus();
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(sidebarButton()).toHaveFocus();
    });
  });

  it('is not offered to an external person, nor in Kurucu alanı', async () => {
    mockApi({
      'GET /session': sessionHandler({
        memberships: [{ ...ARMADX, role: 'external', canApprove: false }],
      }),
    });
    renderApp('/c/armadx');
    const menu = await screen.findByRole('navigation', { name: 'Ana menü' });
    expect(within(menu).queryByRole('button', { name: 'Yeni talep' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Talepler' })).toBeNull();
    // Tasks between people stay a row of their own.
    expect(within(menu).getByRole('link', { name: 'Görevler' })).toBeVisible();
  });
});

describe('Talepler', () => {
  it('groups the requests by whose turn it is and says the stage in words', async () => {
    const waiting = requestDetail();
    const working = requestDetail({
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Kasım bülteni',
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
    });
    const fallen = requestDetail({
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Kasım duyurusu',
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      waitingForMe: true,
    });
    // Returned by the routing: the legal unit has no open agent (8 October decision 2).
    const returned = requestDetail({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'KVKK metni',
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'returned_no_agent',
      turn: { kind: 'none' },
      waitingForMe: false,
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
    });
    const done = requestDetail({
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Ekim duyurusu',
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () =>
        json({
          requests: [working, waiting, done, fallen, returned].map(summaryOf),
          truncated: false,
        }),
    });
    renderApp('/c/armadx/requests');
    const mine = await screen.findByRole('region', { name: /Sizden beklenenler/ });
    expect(
      within(mine)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Onayınız bekleniyor'),
      expect.stringContaining('Sizden bekleniyor: ajan sonuç sunmadı'),
    ]);
    const running = screen.getByRole('region', { name: /Sürenler/ });
    expect(within(running).getByRole('listitem')).toHaveTextContent('Ajan çalışıyor');
    expect(within(running).getByRole('listitem')).toHaveTextContent('SOS-2');
    const [finished, sentBack] = within(
      screen.getByRole('region', { name: /Bitenler/ }),
    ).getAllByRole('listitem');
    expect(finished).toHaveTextContent('Tamamlandı');
    // A returned request is closed and waits for nobody. The row names the stage in words; the
    // status stays the existing "İptal" with its icon, and the link reads the same sentence.
    if (!sentBack) throw new Error('No row for the returned request');
    expect(sentBack).toHaveTextContent('Geri çevrildi: birimde açık ajan yok');
    expect(sentBack).not.toHaveTextContent(/İptal edildi|Sizden bekleniyor|İnsana düştü/);
    expect(within(sentBack).getByRole('img', { name: 'İptal' })).toBeVisible();
    expect(
      within(sentBack).getByRole('link', {
        name: 'KVKK metni, Geri çevrildi: birimde açık ajan yok',
      }),
    ).toHaveAttribute('href', '/c/armadx/requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(within(mine).queryByText(/KVKK metni/)).toBeNull();
    // A row is a link and nothing else: no control changes a status, a unit or an agent.
    const list = screen.getByRole('main');
    expect(within(list).queryAllByRole('combobox')).toEqual([]);
    expect(
      within(list)
        .queryAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Yeni talep']);
    expect(
      within(mine).getByRole('link', {
        name: 'LinkedIn için gönderi yaz, Onayınız bekleniyor, sıra sizde',
      }),
    ).toHaveAttribute('href', `/c/armadx/requests/${REQUEST_ID}`);
    // The founder starts with every request; the switch asks for their own.
    expect(api.callsTo('GET /requests')).toHaveLength(1);
    api.handle('GET /requests?mine=true', () => json({ requests: [], truncated: false }));
    await userEvent.click(screen.getByRole('switch', { name: 'Yalnızca benim taleplerim' }));
    expect(await screen.findByRole('heading', { name: 'Açık talebiniz yok' })).toBeVisible();
  });
});

describe('the page of a request', () => {
  it('shows the approver the card, sends the decision with the chosen option and shows the answer', async () => {
    const approved = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: false,
      approval: null,
      result: RESULT,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            approval: { ...APPROVAL_CARD, needsStepUp: false, goesExternal: false },
          }),
        ),
      [`POST /approvals/${APPROVAL_ID}/decision`]: () => json(approved),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(stageLine()).toContain('Aşama: Onayınız bekleniyor Sıra: sizde Birim: Sosyal Medya');
    // The agent's words are under labels that say whose they are.
    expect(within(card).getByText('Özet (ajan yazdı)')).toBeVisible();
    expect(within(card).getByText('Ajanın gerekçesi')).toBeVisible();
    // Approving needs an option first, and says so.
    const approve = within(card).getByRole('button', { name: 'Onayla' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).toHaveAccessibleDescription('Onaylamak için önce bir seçenek seçin.');
    await userEvent.click(approve);
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)).toHaveLength(0);
    await userEvent.click(within(card).getByRole('radio', { name: /Seçenek B/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Onayla' }));
    // Nothing is shown before the API answers; then the page is what it answered.
    expect(await screen.findByRole('region', { name: 'Sonuç' })).toHaveTextContent(
      'Artık İzmir’deyiz.',
    );
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)[0]?.body).toEqual({
      decision: 'approved',
      selectedOption: 'B',
    });
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(stageLine()).toContain('Aşama: Talep sahibinin onayında Sıra: Ayşe Yılmaz');
    // The journey: fixed sentences from records; the coordinator's reason under its label.
    const journey = screen.getByRole('region', { name: 'Yolculuk' });
    expect(journey).toHaveTextContent('Ayşe Yılmaz talebi gönderdi.');
    expect(journey).toHaveTextContent(
      'Koordinasyon merkezi talebi yönlendirdi: Sosyal Medya, ajan SOS-2',
    );
    expect(journey).toHaveTextContent('Onaylayıcı: Kurucu.');
    // The coordinator's reason is a model's text: the API gives it to a decider only, and the
    // label says so.
    expect(
      within(journey).getByText('Koordinasyon merkezinin gerekçesi (yalnızca siz görürsünüz)'),
    ).toBeVisible();
    await userEvent.click(within(journey).getByRole('button', { name: '38 sn. çalıştı, 1 adım' }));
    expect(journey).toHaveTextContent('Onaya sundu');
    expect(api.unexpected).toEqual([]);
  });

  it('asks for a reason before it sends a change request, and for the passkey before an important approval', async () => {
    const back = requestDetail({
      status: 'in_progress',
      stage: 'revising',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      approval: null,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
      [`POST /approvals/${APPROVAL_ID}/decision`]: () => json(back),
      'POST /step-up/options': () =>
        apiError(
          409,
          'no_passkey',
          'Bu işlem için passkey gerekiyor. Ayarlar, Güvenlik bölümünden bir passkey ekleyin.',
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    // The marks come from the record, apart from the agent's text.
    const marks = within(card).getByLabelText('Kayıttan gelen işaretler');
    expect(marks).toHaveTextContent('Dışarı gidecek');
    expect(marks).toHaveTextContent('Passkey ister');
    // An important approval opens the passkey dialog instead of sending the decision.
    await userEvent.click(within(card).getByRole('radio', { name: /Seçenek A/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Onayla' }));
    const passkey = await screen.findByRole('alertdialog', { name: 'Sonucu onayla' });
    expect(passkey).toHaveTextContent('Seçenek A onaylanacak');
    await waitFor(() => {
      expect(api.callsTo('POST /step-up/options')[0]?.body).toEqual({
        purpose: 'approve',
        companyId: ARMADX.companyId,
        subjectId: APPROVAL_ID,
        details: { decision: 'approved', selectedOption: 'A' },
      });
    });
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)).toHaveLength(0);
    // Each dialog gives the focus back to the button that opened it.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Onayla' })).toHaveFocus();
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Reddet' }));
    const reject = await screen.findByRole('dialog', { name: 'Sonucu reddet' });
    expect(reject).toHaveTextContent('Talep sahibi nedeni ve açıklamanızı okur');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Reddet' })).toHaveFocus();
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Düzeltme iste' }));
    await screen.findByRole('dialog', { name: 'Düzeltme iste' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Düzeltme iste' })).toHaveFocus();
    });

    await userEvent.click(within(card).getByRole('button', { name: 'Düzeltme iste' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzeltme iste' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
    expect(within(dialog).getByText('Bir neden seçin.')).toBeVisible();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Neden' }), 'Diğer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
    expect(within(dialog).getByText('Açıklama yazın.')).toBeVisible();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Açıklama' }),
      'Daha sade olsun.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Ajan düzeltiyor Sıra: SOS-2');
    });
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)[0]?.body).toEqual({
      decision: 'changes_requested',
      reason: 'other',
      note: 'Daha sade olsun.',
    });
  });

  it('gives the requester the result and the acceptance, and nobody else a card', async () => {
    const waiting = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: true,
      approval: null,
      result: RESULT,
      acceptance: { round: 1, returnsToAgent: true },
      actions: { cancel: true, stop: false, reroute: false },
    });
    const done = requestDetail({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
      approval: null,
      result: RESULT,
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(waiting),
      [`POST /requests/${REQUEST_ID}/acceptance`]: () => json(done),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    expect(card).toHaveTextContent('Ömer Kadıoğlu onayladı.');
    expect(stageLine()).toContain('Aşama: Sonucu onaylamanız bekleniyor Sıra: sizde');
    // "Not what I asked for" needs the requester's own words, and nothing else: the requester
    // is not asked to pick from the approver's list of reasons.
    await userEvent.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(dialog).toHaveTextContent('aynı ajana bir kez geri döner');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gönder' }));
    expect(within(dialog).getByText('Açıklama yazın.')).toBeVisible();
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/acceptance`)).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'İstediğim bu değil' })).toHaveFocus();
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Sonucu onayla' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Tamamlandı');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/acceptance`)[0]?.body).toEqual({
      decision: 'approved',
    });
    expect(screen.queryByRole('region', { name: 'Sonuç hazır' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Talebi iptal et' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Sonuç' })).toBeVisible();
  });

  it('sends the requester’s own words, and says the truth about the second time', async () => {
    const waiting = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: true,
      approval: null,
      result: RESULT,
      acceptance: { round: 2, returnsToAgent: false },
      actions: { cancel: true, stop: false, reroute: false },
    });
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'second_change_request',
      turn: { kind: 'founder' },
      waitingForMe: false,
      approval: null,
      result: RESULT,
      actions: { cancel: true, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(waiting),
      [`POST /requests/${REQUEST_ID}/acceptance`]: () => json(fallen),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    await userEvent.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    // The second time the work does not go back to the agent: it falls to the founder (8 October
    // decision 3), and the dialog says so.
    expect(dialog).toHaveTextContent(
      'Bu ikinci isteğiniz: iş ajana kendiliğinden dönmez, kurucuya düşer.',
    );
    expect(dialog).not.toHaveTextContent(/onaylayıcısına|geri döner/);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Açıklama' }), 'Çok uzun.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gönder' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İnsana düştü: ikinci düzeltme isteği Sıra: Kurucu');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/acceptance`)[0]?.body).toEqual({
      decision: 'changes_requested',
      note: 'Çok uzun.',
    });
    // The requester cannot act on it and is not told that they can.
    expect(screen.queryByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeNull();
    expect(screen.getByText(/Talebiniz kayıtlı\. Sıradaki adımı Kurucu atacak\./)).toBeVisible();
    expect(screen.queryByText(/Yönlendirmeyi düzelt/)).toBeNull();
  });

  it('counts the requester’s own change requests, not the rounds of the acceptance', async () => {
    // The routing was corrected while the result waited for the requester: the new result opened
    // round 2, and the requester has not said "not what I asked for" yet. The API says the work
    // goes back to the agent, and so does the dialog.
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            stage: 'requester_approval',
            turn: { kind: 'person', ...EMPLOYEE },
            waitingForMe: true,
            approval: null,
            result: RESULT,
            acceptance: { round: 2, returnsToAgent: true },
            actions: { cancel: true, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    await userEvent.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(dialog).toHaveTextContent('İş bu açıklamayla aynı ajana bir kez geri döner');
    expect(dialog).not.toHaveTextContent(/ikinci isteğiniz|kurucuya düşer/);
  });

  // The founder's own example: a KVKK text, routed to the legal unit, which has no agent. The
  // request went back to its requester and was closed (8 October decision 2). The API gives the
  // coordinator's own reason to nobody but the one who may decide.
  const returnedRequest = (reason: string | null) =>
    requestDetail({
      title: 'KVKK aydınlatma metni hazırlansın',
      text: 'KVKK aydınlatma metni hazırlansın',
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'returned_no_agent',
      turn: { kind: 'none' },
      waitingForMe: false,
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
      agent: null,
      approval: null,
      closure: null,
      journey: [
        {
          kind: 'run',
          id: '44444444-4444-4444-8444-444444444444',
          at: '2026-10-07T09:00:00.000Z',
          agent: { code: 'KOR-1', name: 'Ofis Koordinatörü' },
          status: 'completed',
          finishedAt: '2026-10-07T09:00:04.000Z',
          durationMs: 4000,
          errorCode: null,
          summary:
            'Talep Hukuk ve Uyum birimine yönlendirildi; birimde işi alabilecek açık ajan olmadığı için talep sahibine geri çevrildi.',
          agentText: null,
          steps: [{ tool: 'route_task', status: 'succeeded' }],
        },
        {
          kind: 'routing',
          id: '66666666-6666-4666-8666-666666666666',
          at: '2026-10-07T09:00:00.000Z',
          round: 1,
          unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
          agent: null,
          approver: null,
          by: null,
          reason,
        },
      ],
      actions: { cancel: false, stop: false, reroute: false },
    });
  const RETURNED_WHY =
    'Talep geri çevrildi: Hukuk ve Uyum biriminde bu işi alabilecek açık ajan yok.';
  const RETURNED_THEN =
    'Talep kapandı; bu iş için bir ajan açıldığında yeni bir talep gönderebilirsiniz.';

  it('a returned request tells its requester why with the unit’s name, that it is closed, and offers nothing', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(returnedRequest(null)),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    // The two sentences of the notice: why, with the unit's name, and what follows from it.
    expect(await screen.findByText(RETURNED_WHY)).toBeVisible();
    expect(screen.getByText(RETURNED_THEN)).toBeVisible();
    // The header names the stage in words; the status is the existing "İptal".
    expect(stageLine()).toBe('Aşama: Geri çevrildi: birimde açık ajan yok Birim: Hukuk ve Uyum');
    expect(
      within(screen.getByRole('heading', { level: 2, name: /KVKK aydınlatma metni/ })).getByRole(
        'img',
        {
          name: 'İptal',
        },
      ),
    ).toBeVisible();
    // Nothing is offered, and no sentence names a way on for this request.
    for (const name of ['Yönlendirmeyi düzelt', 'İşi durdur', 'Talebi iptal et']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    const page = screen.getByRole('main');
    expect(page).not.toHaveTextContent(/Yönlendirmeyi düzelt|kapatabilirsiniz|iptal etti|durdurdu/);
    expect(page).not.toHaveTextContent(/Sizden bekleniyor|Bir kişi ilgilenecek|İnsana düştü/);
    // The journey says the same in the code's own words (the run's summary and the step), names
    // no approver for a step nobody works on, and shows no reason of the coordinator.
    const journey = screen.getByRole('region', { name: 'Yolculuk' });
    expect(journey).toHaveTextContent(
      'Talep Hukuk ve Uyum birimine yönlendirildi; birimde işi alabilecek açık ajan olmadığı için talep sahibine geri çevrildi.',
    );
    expect(journey).toHaveTextContent(
      'Koordinasyon merkezi talebi yönlendirdi: Hukuk ve Uyum; birimde bu işi alabilecek açık ajan yok.',
    );
    expect(journey).not.toHaveTextContent(/Onaylayıcı|gerekçesi/);
    expect(api.unexpected).toEqual([]);
  });

  it('the founder reads the same notice on a returned request, with the coordinator’s reason, and is offered nothing either', async () => {
    const reason = 'Hukuk ve uyum işi; birimde bunu yazabilecek ajan yok.';
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(returnedRequest(reason)),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText(RETURNED_WHY)).toBeVisible();
    expect(screen.getByText(RETURNED_THEN)).toBeVisible();
    expect(stageLine()).toBe('Aşama: Geri çevrildi: birimde açık ajan yok Birim: Hukuk ve Uyum');
    // The coordinator's own words stay in the journey, under the label that says whose they are.
    const journey = screen.getByRole('region', { name: 'Yolculuk' });
    expect(
      within(journey).getByText('Koordinasyon merkezinin gerekçesi (yalnızca siz görürsünüz)'),
    ).toBeVisible();
    expect(within(journey).getByText(reason)).toBeVisible();
    for (const name of ['Yönlendirmeyi düzelt', 'İşi durdur', 'Talebi iptal et']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // No way on is named for a closed request, also not to the one who could open an agent.
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /Yönlendirmeyi düzelt|Ofis görünümünden|kapatabilirsiniz|Sizden bekleniyor/,
    );
    expect(api.unexpected).toEqual([]);
  });

  it('a request that fell to a person is not a dead end: the founder corrects the routing', async () => {
    // The unit agent ended its run without submitting; the founder gives the work to an agent.
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      turn: { kind: 'founder' },
      waitingForMe: true,
      // The request's own unit has no open agent any more.
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
      agent: null,
      approval: null,
      journey: [],
      actions: { cancel: false, stop: true, reroute: true },
    });
    const rerouted = requestDetail({
      ...fallen,
      status: 'in_progress',
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      unit: { code: 'SOS', name: 'Sosyal Medya' },
      agent: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [`GET /requests/${REQUEST_ID}/routing-options`]: () =>
        json({
          units: [
            { code: 'HUK', name: 'Hukuk ve Uyum', agents: [] },
            {
              code: 'SOS',
              name: 'Sosyal Medya',
              agents: [{ code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' }],
            },
          ],
        }),
      [`POST /requests/${REQUEST_ID}/routing`]: () => json(rerouted),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText('Ajan sonucu onaya sunmadan çalışmasını bitirdi.'),
    ).toBeVisible();
    // No sentence promises that opening an agent revives the request; the way on is named.
    expect(screen.queryByText(/Ofis görünümünden açabilirsiniz/)).toBeNull();
    expect(
      screen.getByText(/"Yönlendirmeyi düzelt" ile işi aynı ajana yeniden verebilir/),
    ).toBeVisible();
    const open = screen.getByRole('button', { name: 'Yönlendirmeyi düzelt' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    const unit = await within(dialog).findByRole('combobox', { name: 'Birim' });
    // A unit without an open agent stays in the list, so that the founder sees why it cannot be
    // chosen, and cannot be picked.
    await waitFor(() => {
      expect(
        within(unit).getByRole('option', { name: 'Hukuk ve Uyum (açık ajan yok)' }),
      ).toBeDisabled();
    });
    expect(within(unit).getByRole('option', { name: 'Sosyal Medya' })).toBeEnabled();
    // The request's own unit has no open agent, so nothing is chosen to begin with; no approver
    // can be chosen anywhere.
    expect(unit).toHaveValue('');
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(2);
    const agent = within(dialog).getByRole('combobox', { name: 'Ajan' });
    expect(agent).toBeDisabled();
    // No way to leave the request at a unit without an agent.
    expect(within(dialog).queryByRole('option', { name: /Ajan yok/ })).toBeNull();
    expect(dialog).not.toHaveTextContent(/onaylayıcısına düşer/);
    await userEvent.selectOptions(unit, 'HUK').catch(() => undefined);
    expect(unit).toHaveValue('');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
    });
    await userEvent.click(open);
    const again = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    await waitFor(() => {
      expect(within(again).getByRole('option', { name: 'Sosyal Medya' })).toBeVisible();
    });
    const send = within(again).getByRole('button', { name: 'Yönlendir' });
    // Nothing chosen: the form says which field is missing and sends nothing.
    await userEvent.click(send);
    expect(within(again).getByRole('alert')).toHaveTextContent('Bir birim seçin.');
    await userEvent.selectOptions(within(again).getByRole('combobox', { name: 'Birim' }), 'SOS');
    // A unit alone is not enough: an agent must be chosen.
    const agentBox = within(again).getByRole('combobox', { name: 'Ajan' });
    expect(agentBox).toBeEnabled();
    expect(agentBox).toHaveValue('');
    expect(
      within(agentBox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Seçin', 'SOS-2 Sosyal İçerik Yazım Ajanı']);
    await userEvent.click(send);
    expect(within(again).getByRole('alert')).toHaveTextContent('Bir ajan seçin.');
    expect(agentBox).toBeInvalid();
    expect(agentBox).toHaveAccessibleDescription(
      /Yalnızca bu şirkette açık olan ajanlar listelenir/,
    );
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(0);
    await userEvent.selectOptions(agentBox, 'SOS-2');
    expect(within(again).queryByRole('alert')).toBeNull();
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Açıklama (isteğe bağlı)' }),
      'Taslağı sosyal içerik ajanı yazsın.',
    );
    await userEvent.click(send);
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Ajan çalışıyor Sıra: SOS-2 Birim: Sosyal Medya');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(1);
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)[0]?.body).toEqual({
      unitCode: 'SOS',
      agentCode: 'SOS-2',
      note: 'Taslağı sosyal içerik ajanı yazsın.',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('the correction dialog says so and offers no send when no unit has an open agent', async () => {
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'agent_stopped',
      approval: null,
      journey: [],
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [`GET /requests/${REQUEST_ID}/routing-options`]: () =>
        json({
          units: [
            { code: 'HUK', name: 'Hukuk ve Uyum', agents: [] },
            { code: 'SOS', name: 'Sosyal Medya', agents: [] },
          ],
        }),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const open = await screen.findByRole('button', { name: 'Yönlendirmeyi düzelt' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    expect(
      await within(dialog).findByText(
        'Şu an hiçbir birimde açık ajan yok; talep bir ajana verilemez.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Yönlendir' })).toBeNull();
    expect(within(dialog).queryAllByRole('combobox')).toEqual([]);
    // The dialog closes as before and gives the focus back.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(0);
    expect(api.unexpected).toEqual([]);
  });

  it('shows what an agent wrote without submitting to the decider alone, under its own label', async () => {
    const journey = DEFAULT_JOURNEY.map((item, index) =>
      item.kind === 'run' && index === 2
        ? {
            ...item,
            summary: 'Ajan sonucu onaya sunmadan çalışmasını bitirdi.',
            agentText: 'Kaynak bilgi yetersiz: açılış tarihi yok.',
            steps: [],
          }
        : item,
    );
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      approval: null,
      journey,
    });
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      (await screen.findAllByText('Ajan sonucu onaya sunmadan çalışmasını bitirdi.')).length,
    ).toBeGreaterThan(0);
    // Once, in the notice where the decision is made; not repeated in the journey.
    expect(
      screen.getByText('SOS-2 şunu yazdı (onaylanmadı; yalnızca siz görürsünüz)'),
    ).toBeVisible();
    expect(screen.getByText('Kaynak bilgi yetersiz: açılış tarihi yok.')).toBeVisible();
    expect(screen.getByText(/işi aynı ajana yeniden verebilir/)).toBeVisible();
  });

  it('whoever stops somebody else’s request says why, and the requester reads it', async () => {
    const stopped = requestDetail({
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'stopped',
      turn: { kind: 'none' },
      waitingForMe: false,
      approval: null,
      closure: { by: FOUNDER, reason: null, note: 'Bu iş bu hafta yapılmayacak.' },
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
      [`POST /requests/${REQUEST_ID}/close`]: () => json(stopped),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const stop = await screen.findByRole('button', { name: 'İşi durdur' });
    await userEvent.click(stop);
    const confirm = await screen.findByRole('alertdialog', { name: 'İş durdurulsun mu?' });
    expect(confirm).toHaveTextContent('durdurmak yerine yönlendirmeyi düzeltebilirsiniz');
    await userEvent.click(within(confirm).getByRole('button', { name: 'İşi durdur' }));
    expect(within(confirm).getByRole('alert')).toHaveTextContent('Bir neden yazın.');
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(stop).toHaveFocus();
    });
    await userEvent.click(stop);
    const again = await screen.findByRole('alertdialog', { name: 'İş durdurulsun mu?' });
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Neden' }),
      'Bu iş bu hafta yapılmayacak.',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'İşi durdur' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İptal edildi: durduruldu');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)[0]?.body).toEqual({
      reason: 'Bu iş bu hafta yapılmayacak.',
    });
    // Who closed it and why, in that person's words.
    expect(screen.getByText('Ömer Kadıoğlu işi durdurdu.')).toBeVisible();
    expect(screen.getByText('Bu iş bu hafta yapılmayacak.')).toBeVisible();
  });

  it('tells the requester who rejected the result and why, never the output', async () => {
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'rejected',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            closure: {
              by: FOUNDER,
              reason: 'out_of_scope',
              note: 'Bu konuda gönderi yayınlamıyoruz.',
            },
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText('Ömer Kadıoğlu sonucu reddetti: Kapsam dışı.')).toBeVisible();
    expect(screen.getByText('Bu konuda gönderi yayınlamıyoruz.')).toBeVisible();
    expect(stageLine()).toContain('Aşama: İptal edildi: sonuç reddedildi');
    expect(screen.queryByRole('region', { name: 'Sonuç' })).toBeNull();
  });

  it('a request stopped after its result was delivered says so, and keeps the result', async () => {
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'closed_after_delivery',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            result: RESULT,
            closure: { by: FOUNDER, reason: null, note: 'Talep sahibi izinde.' },
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText(/Ömer Kadıoğlu talebi kapattı\. Onaylanan sonuç aşağıda/),
    ).toBeVisible();
    expect(stageLine()).toContain('Aşama: Kapatıldı: sonuç iletildi, talep sahibi yanıtlamadı');
    expect(screen.getByRole('region', { name: 'Sonuç' })).toHaveTextContent('Artık İzmir’deyiz.');
  });

  it('says where a money mark comes from', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            approval: { ...APPROVAL_CARD, involvesMoney: true, moneyStatedBy: 'agent' },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(within(card).getByLabelText('Kayıttan gelen işaretler')).toHaveTextContent(
      'Para içeriyor (ajan belirtti)',
    );
  });

  it('says why a request fell to a person, tells the founder what to do, and lets the requester cancel', async () => {
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'model_unavailable',
      turn: { kind: 'founder' },
      waitingForMe: true,
      unit: null,
      agent: null,
      approval: null,
      requester: FOUNDER,
      journey: [],
      actions: { cancel: true, stop: false, reroute: false },
    });
    const cancelled = requestDetail({
      ...fallen,
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'cancelled_by_requester',
      turn: { kind: 'none' },
      waitingForMe: false,
      closure: { by: { userId: USER_ID, name: 'Ömer Kadıoğlu' }, reason: null, note: null },
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [`POST /requests/${REQUEST_ID}/close`]: () => json(cancelled),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText('Ajanlar şu an çalışamıyor: model hizmetine bağlanılamadı.'),
    ).toBeVisible();
    expect(screen.getByText(/Anthropic API anahtarı tanımlı değil/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Talebi iptal et' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Talep iptal edilsin mi?' });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)).toHaveLength(0);
    // A cancel needs no reason.
    await userEvent.click(within(confirm).getByRole('button', { name: 'Talebi iptal et' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İptal edildi: talep sahibi iptal etti');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)[0]?.body).toEqual({});
    expect(screen.queryByRole('button', { name: 'Talebi iptal et' })).toBeNull();
    expect(screen.getByText('Ömer Kadıoğlu talebi iptal etti.')).toBeVisible();
  });

  it('answers a hidden, a missing and a malformed id with the same screen', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        apiError(404, 'not_found', 'Aradığınız kayıt bulunamadı.'),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByRole('heading', { name: 'Talep bulunamadı' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Taleplere dön' })).toHaveAttribute(
      'href',
      '/c/armadx/requests',
    );
  });

  it('starts another result with nothing chosen: the option picked for the one before is not carried over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const key = `GET /requests/${REQUEST_ID}`;
      const NEXT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const first = { ...APPROVAL_CARD, needsStepUp: false, goesExternal: false };
      const api = mockApi({
        'GET /session': sessionHandler(),
        [key]: () => json(requestDetail({ approval: first })),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
      await user.click(within(card).getByRole('radio', { name: /Seçenek B/ }));
      expect(within(card).getByRole('button', { name: 'Onayla' })).not.toHaveAttribute(
        'aria-disabled',
      );
      // Changes were asked for from another tab and the agent submitted again: the next refresh
      // brings another approval with other texts into the place of the card.
      api.handle(key, () =>
        json(
          requestDetail({
            approval: {
              ...first,
              id: NEXT_ID,
              attempt: 2,
              options: [
                { code: 'A', text: 'Yeni A metni', hashtags: [] },
                { code: 'B', text: 'Yeni B metni', hashtags: [] },
              ],
            },
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      expect(await screen.findByText('Yeni B metni')).toBeVisible();
      // Nobody chose an option of this result.
      for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
      const approve = screen.getByRole('button', { name: 'Onayla' });
      expect(approve).toHaveAttribute('aria-disabled', 'true');
      await user.click(approve);
      expect(api.callsTo(`POST /approvals/${NEXT_ID}/decision`)).toHaveLength(0);
      expect(api.unexpected).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an open reason dialog and its text when the approval stops waiting meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const key = `GET /requests/${REQUEST_ID}`;
      const refusal =
        'Bu onay kapanmış: karar verilmiş ya da dayandığı talep değişmiş. Sayfayı yenileyin.';
      const api = mockApi({
        'GET /session': sessionHandler(),
        [key]: () => json(requestDetail()),
        [`POST /approvals/${APPROVAL_ID}/decision`]: () =>
          apiError(409, 'approval_closed', refusal),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
      await user.click(within(card).getByRole('button', { name: 'Düzeltme iste' }));
      const dialog = await screen.findByRole('dialog', { name: 'Düzeltme iste' });
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Neden' }), 'Eksik');
      const note = within(dialog).getByRole('textbox', { name: /^Açıklama/ });
      await user.type(note, 'Açılış tarihi eksik.');
      // The requester cancels meanwhile: the approval no longer waits.
      api.handle(key, () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'cancelled_by_requester',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            closure: { by: EMPLOYEE, reason: null, note: null },
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
      );
      const before = api.callsTo(key).length;
      // Neither the timer nor coming back to the tab reads the request under the open dialog.
      await vi.advanceTimersByTimeAsync(31_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(api.callsTo(key)).toHaveLength(before);
      expect(screen.getByRole('dialog', { name: 'Düzeltme iste' })).toBeVisible();
      expect(note).toHaveValue('Açılış tarihi eksik.');
      // The person sends and reads the API's own answer in the dialog, with the text still there.
      await user.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
      expect(await within(dialog).findByText(refusal)).toBeVisible();
      expect(note).toHaveValue('Açılış tarihi eksik.');
      // Closing the dialog reads the page again: it now says what happened.
      await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      expect(await screen.findByText('Ayşe Yılmaz talebi iptal etti.')).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        screen.queryByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' }),
      ).toBeNull();
      expect(api.callsTo(key)).toHaveLength(before + 1);
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('links back to the list from the top bar', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    // The top bar is the header that holds the page's h1 (the page and its cards have headers too),
    // and the h1 names the request, not the list.
    const title = screen.getByRole('heading', { level: 1, name: 'LinkedIn için gönderi yaz' });
    const bar = title.closest('header');
    if (!bar) throw new Error('No top bar');
    expect(within(bar).getByRole('link', { name: 'Talepler' })).toHaveAttribute(
      'href',
      '/c/armadx/requests',
    );
  });

  it('opens the list of the other company when the company is changed: its request is not there', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'PUT /session/company': () => noContent(),
    });
    const { router } = renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    await userEvent.click(screen.getByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', { name: 'Pillika' }),
    );
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe('/c/pillika/requests');
    });
    expect(await screen.findByRole('heading', { name: 'Henüz talep yok' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Talep bulunamadı' })).toBeNull();
    // Pillika is asked for its list and never for the request of Arma DX.
    expect(api.callsTo('GET /requests').map((call) => call.headers.get(COMPANY_HEADER))).toEqual([
      PILLIKA.companyId,
    ]);
    expect(
      api.callsTo(`GET /requests/${REQUEST_ID}`).map((call) => call.headers.get(COMPANY_HEADER)),
    ).toEqual([ARMADX.companyId]);
    expect(api.unexpected).toEqual([]);
  });

  it('refreshes in the background, faster while a machine has the turn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const working = requestDetail({
        status: 'in_progress',
        stage: 'working',
        turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
        waitingForMe: false,
        approval: null,
      });
      const api = mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () => json(working),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      await screen.findByText('Ajan çalışıyor');
      const key = `GET /requests/${REQUEST_ID}`;
      expect(api.callsTo(key)).toHaveLength(1);
      api.handle(key, () => json(requestDetail()));
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => {
        expect(api.callsTo(key)).toHaveLength(2);
      });
      // The refresh is a background request: it does not extend the idle time (rule 3).
      expect(api.callsTo(key)[1]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      expect(api.callsTo(key)[0]?.headers.get(BACKGROUND_HEADER)).toBeNull();
      expect(
        await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' }),
      ).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Onaylar', () => {
  it('lists what waits for the person in two groups and counts them on the sidebar row', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /approvals': () =>
        json({
          approvals: [APPROVAL_CARD],
          acceptances: [
            {
              requestId: '77777777-7777-4777-8777-777777777777',
              requestTitle: 'Kasım bülteni',
              round: 1,
              returnsToAgent: false,
              openedAt: '2026-10-07T09:00:00.000Z',
              result: RESULT,
            },
          ],
        }),
    });
    renderApp('/c/armadx/approvals');
    const approvals = await screen.findByRole('region', { name: /Birim onayları/ });
    expect(within(approvals).getByRole('link', { name: 'Talebi aç' })).toHaveAttribute(
      'href',
      `/c/armadx/requests/${REQUEST_ID}`,
    );
    expect(within(approvals).getByRole('button', { name: 'Onayla' })).toBeVisible();
    const results = screen.getByRole('region', { name: /Taleplerinizin sonuçları/ });
    expect(within(results).getByRole('button', { name: 'Sonucu onayla' })).toBeVisible();
    expect(within(results).getByRole('link', { name: 'Kasım bülteni' })).toBeVisible();
    // The card says here too what "not what I asked for" does this time, as the API gave it.
    await userEvent.click(within(results).getByRole('button', { name: 'İstediğim bu değil' }));
    const asking = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(asking).toHaveTextContent('iş ajana kendiliğinden dönmez, kurucuya düşer.');
    await userEvent.click(within(asking).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Nothing can be dismissed or postponed.
    expect(screen.queryByRole('button', { name: /Arşiv|Ertele|Kapat/ })).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', {
        name: 'Onaylar, 2 bekleyen',
      }),
    ).toBeVisible();
  });

  it('keeps an open reason dialog and its text when the card leaves the desk meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let waiting = true;
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /approvals': () =>
          json({ approvals: waiting ? [APPROVAL_CARD] : [], acceptances: [] }),
      });
      renderApp('/c/armadx/approvals');
      const approvals = await screen.findByRole('region', { name: /Birim onayları/ });
      await user.click(within(approvals).getByRole('button', { name: 'Düzeltme iste' }));
      const dialog = await screen.findByRole('dialog', { name: 'Düzeltme iste' });
      const note = within(dialog).getByRole('textbox', { name: /^Açıklama/ });
      await user.type(note, 'Daha sade olsun.');
      // Somebody else decided it. The desk is read by the screen and by the sidebar's count;
      // neither reads it under the open dialog.
      waiting = false;
      const before = api.callsTo('GET /approvals').length;
      await vi.advanceTimersByTimeAsync(31_000);
      expect(api.callsTo('GET /approvals')).toHaveLength(before);
      expect(screen.getByRole('dialog', { name: 'Düzeltme iste' })).toBeVisible();
      expect(note).toHaveValue('Daha sade olsun.');
      // Closing the dialog reads the desk again.
      await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      expect(await screen.findByRole('heading', { name: 'Onay bekleyen iş yok' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what will appear here when nothing waits', async () => {
    mockApi({ 'GET /session': sessionHandler(EMPLOYEE_SESSION) });
    renderApp('/c/armadx/approvals');
    expect(
      await screen.findByRole('heading', { name: 'Onayınızı bekleyen sonuç yok' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', {
        name: 'Onaylar',
      }),
    ).toBeVisible();
  });
});
