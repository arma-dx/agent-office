import { COMPANY_HEADER, BACKGROUND_HEADER } from '@agent-office/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, ARMADX, json, mockApi, sessionHandler, USER_ID } from './test/mock-api.ts';
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
    // What the form says before anything is sent: where the text goes, what not to write, and
    // who will be able to read the request.
    const notice = within(dialog).getByText(/yapay zekâ modeline gönderilir/);
    expect(notice).toHaveTextContent(
      'Kişisel veri ve yapay zekâ kullanımına izin vermeyen müşterilerin bilgisini yazmayın.',
    );
    expect(notice).toHaveTextContent('şirketteki kurucu ve çalışanlar görebilir');
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
      title: 'KVKK metni',
      status: 'open',
      stage: 'fell_to_person',
      cause: 'no_agent',
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
      waitingForMe: true,
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
        json({ requests: [working, waiting, done, fallen].map(summaryOf), truncated: false }),
    });
    renderApp('/c/armadx/requests');
    const mine = await screen.findByRole('region', { name: /Sizden beklenenler/ });
    expect(
      within(mine)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Onayınız bekleniyor'),
      expect.stringContaining('Sizden bekleniyor: birimde açık ajan yok'),
    ]);
    const running = screen.getByRole('region', { name: /Sürenler/ });
    expect(within(running).getByRole('listitem')).toHaveTextContent('Ajan çalışıyor');
    expect(within(running).getByRole('listitem')).toHaveTextContent('SOS-2');
    expect(
      within(screen.getByRole('region', { name: /Bitenler/ })).getByRole('listitem'),
    ).toHaveTextContent('Tamamlandı');
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
      acceptance: { round: 1 },
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
      acceptance: { round: 2 },
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
    // The second time the work does not go back to the agent, and the dialog says so.
    expect(dialog).toHaveTextContent(
      'Bu ikinci isteğiniz: iş ajana kendiliğinden dönmez, birimin onaylayıcısına düşer.',
    );
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

  it('a request that fell to a person is not a dead end: the founder corrects the routing', async () => {
    // The founder's own example: a KVKK text, routed to the legal unit, which has no agent.
    const fallen = requestDetail({
      title: 'KVKK aydınlatma metni hazırlansın',
      status: 'open',
      stage: 'fell_to_person',
      cause: 'no_agent',
      turn: { kind: 'founder' },
      waitingForMe: true,
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
      await screen.findByText(
        'Talep bu birime yönlendirildi ama birimde işi alabilecek açık ajan yok.',
      ),
    ).toBeVisible();
    // No sentence promises that opening an agent revives the request; the way on is named.
    expect(screen.queryByText(/Ofis görünümünden açabilirsiniz/)).toBeNull();
    expect(
      screen.getByText(/"Yönlendirmeyi düzelt" ile talebi açık bir ajana verebilir/),
    ).toBeVisible();
    const open = screen.getByRole('button', { name: 'Yönlendirmeyi düzelt' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    const unit = await within(dialog).findByRole('combobox', { name: 'Birim' });
    await waitFor(() => {
      expect(
        within(unit).getByRole('option', { name: 'Hukuk ve Uyum (açık ajan yok)' }),
      ).toBeVisible();
    });
    // The request's own unit is chosen to begin with; no approver can be chosen anywhere.
    expect(unit).toHaveValue('HUK');
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(2);
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
    await userEvent.selectOptions(within(again).getByRole('combobox', { name: 'Birim' }), 'SOS');
    await userEvent.selectOptions(within(again).getByRole('combobox', { name: 'Ajan' }), 'SOS-2');
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Açıklama (isteğe bağlı)' }),
      'Taslağı sosyal içerik ajanı yazsın.',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'Yönlendir' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Ajan çalışıyor Sıra: SOS-2 Birim: Sosyal Medya');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)[0]?.body).toEqual({
      unitCode: 'SOS',
      agentCode: 'SOS-2',
      note: 'Taslağı sosyal içerik ajanı yazsın.',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
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
    // Nothing can be dismissed or postponed.
    expect(screen.queryByRole('button', { name: /Arşiv|Ertele|Kapat/ })).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', {
        name: 'Onaylar, 2 bekleyen',
      }),
    ).toBeVisible();
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
