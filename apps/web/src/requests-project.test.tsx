import { COMPANY_HEADER } from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { QueryClientProvider } from '@tanstack/react-query';
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
import { formatDay } from './lib/dates.ts';
import { RequestDialogProvider } from './components/requests/request-dialog.tsx';
import { clearDrafts, draftKey } from './lib/drafts.ts';
import { createQueryClient } from './lib/query.ts';
import { useOpenRequestDialog, useOpenRequestDialogFor } from './lib/requests/dialog.ts';
import { CompanyContext, SessionContext } from './lib/session.ts';
import {
  apiError,
  ARMADX,
  json,
  mockApi,
  sessionBody,
  sessionHandler,
  USER_ID,
  type ApiCall,
  type Handler,
} from './test/mock-api.ts';
import { ASSERTION } from './test/passkeys.ts';
import { project, PROJECT_ID } from './test/project-fixtures.ts';
import {
  APPROVAL_CARD,
  APPROVAL_ID,
  DEFAULT_JOURNEY,
  EMPLOYEE,
  FOUNDER,
  PROJECT_REF,
  REQUEST_ID,
  RESULT,
  requestDetail,
  summaryOf,
} from './test/request-fixtures.ts';
import { renderApp } from './test/render-app.tsx';
import { renderInRouter } from './test/render-in-router.tsx';

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

// The "Proje" field of the form (8 October decisions 11 and 17). The form offers what the API lists
// for the person (GET /projects: every project of the company for the founder, the member's own
// for an employee); what it offers and how is decided in lib/requests/project-options.ts.
describe('Yeni talep: the project', () => {
  const LANSMAN = project({
    id: PROJECT_ID,
    name: 'Lansman',
    aiAllowed: true,
    agentsMayWork: true,
    customer: null,
  });
  const OTHER_ID = 'a2222222-2222-4222-8222-222222222222';
  const CAGRI = project({
    id: OTHER_ID,
    name: 'Çağrı merkezi',
    aiAllowed: true,
    agentsMayWork: true,
    customer: null,
  });
  const NO_AI = project({
    id: 'a3333333-3333-4333-8333-333333333333',
    name: 'Depo otomasyonu',
    aiAllowed: false,
    agentsMayWork: false,
  });
  const CLOSED = project({
    id: 'a4444444-4444-4444-8444-444444444444',
    name: 'Arşiv taşıma',
    status: 'completed',
    closed: true,
    aiAllowed: true,
    agentsMayWork: true,
    customer: null,
  });
  const HELP =
    'İsteğe bağlı. Proje seçerseniz talebi yalnızca o projenin üyeleri ve kurucu görür, ajanlar da o projenin içinde çalışır. Proje, talep gönderildikten sonra değiştirilemez.';
  const FOR_COMPANY =
    'Talep metni yapay zekâ modeline gönderilir. Talebi ve onaylanan sonucunu şirketteki kurucu ve çalışanlar görebilir.';
  const FOR_PROJECT =
    'Talep metni yapay zekâ modeline gönderilir. Talebi ve onaylanan sonucunu yalnızca bu projenin üyeleri ve kurucu görebilir.';
  const GONE = 'Bu projede artık talep açılamıyor. Başka bir proje ya da "Proje yok" seçin.';
  const LIST_FAILED =
    'Proje listesi alınamadı. Talebi projesiz gönderebilir ya da listeyi yeniden okuyabilirsiniz.';

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
  /** The record the API answers holds what it was sent. */
  const storedFrom = (call: ApiCall) => {
    const sent = call.body as { text: string; projectId?: string };
    return {
      ...created,
      text: sent.text,
      project: sent.projectId === undefined ? null : { id: sent.projectId, name: 'Lansman' },
    };
  };
  const listOf =
    (...projects: ReturnType<typeof project>[]): Handler =>
    () =>
      json({ projects, truncated: false });
  const handlers = (projects: Handler, session: Handler = sessionHandler()) => ({
    'GET /session': session,
    'GET /requests': () => json({ requests: [], truncated: false }),
    'GET /requests?mine=true': () => json({ requests: [], truncated: false }),
    'GET /projects': projects,
    'POST /requests': (call: ApiCall) => json(storedFrom(call), 201),
    [`GET /requests/${REQUEST_ID}`]: () => json(created),
  });

  async function openList(): Promise<void> {
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: /Henüz talep yok|Açık talebiniz yok/ });
  }
  async function openForm(): Promise<HTMLElement> {
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('button', {
        name: 'Yeni talep',
      }),
    );
    return screen.findByRole('dialog', { name: 'Yeni talep' });
  }
  async function closeForm(): Promise<void> {
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }
  /** The select once the list has been read. */
  async function projectField(dialog: HTMLElement): Promise<HTMLSelectElement> {
    const field = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Proje' });
    await waitFor(() => {
      expect(field).toBeEnabled();
    });
    return field;
  }
  const labels = (field: HTMLElement) =>
    within(field)
      .getAllByRole('option')
      .map((option) => option.textContent);
  const whoReads = (dialog: HTMLElement) =>
    within(dialog).getByText(/yapay zekâ modeline gönderilir/);
  const sendButton = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Talebi gönder' });
  const textBox = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: 'Ne istiyorsunuz?' });

  it('form: Proje offers the open projects by name, with Proje yok first, and no closed project', async () => {
    const api = mockApi(handlers(listOf(LANSMAN, CLOSED, CAGRI)));
    await openList();
    const dialog = await openForm();
    const field = await projectField(dialog);
    expect(labels(field)).toEqual(['Proje yok', 'Çağrı merkezi', 'Lansman']);
    expect(field).toHaveValue('');
    expect(field).not.toBeRequired();
    expect(field).toBeValid();
    expect(field).toHaveAccessibleDescription(HELP);
    // The one choice the form offers: still no control for a unit, an agent or an approver.
    expect(within(dialog).getAllByRole('combobox')).toEqual([field]);
    // It stands after the text and before the due day.
    const controls = [...dialog.querySelectorAll('textarea, select, input')];
    expect(controls).toEqual([
      textBox(dialog),
      field,
      within(dialog).getByLabelText('Son tarih (isteğe bağlı)'),
    ]);
    // The list is asked for the selected company when the form opens; the focus stays on the text.
    const [call] = api.callsTo('GET /projects');
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(textBox(dialog)).toHaveFocus();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('form: a project where agents may not work is offered disabled, and the help says who opens the permission, in the founder’s words and in an employee’s', async () => {
    const CLOSED_HELP = 'Ajanların çalışamadığı projede talep açılamaz.';
    mockApi(handlers(listOf(NO_AI, LANSMAN)));
    await openList();
    let dialog = await openForm();
    let field = await projectField(dialog);
    expect(labels(field)).toEqual(['Proje yok', 'Depo otomasyonu (ajanlar çalışamaz)', 'Lansman']);
    const offered = within(field).getByRole('option', {
      name: 'Depo otomasyonu (ajanlar çalışamaz)',
    });
    expect(offered).toBeDisabled();
    expect(within(field).getByRole('option', { name: 'Lansman' })).toBeEnabled();
    // It cannot be chosen.
    await userEvent.selectOptions(field, NO_AI.id).catch(() => undefined);
    expect(field).toHaveValue('');
    expect(field).toHaveAccessibleDescription(
      `${HELP} ${CLOSED_HELP} Yapay zekâ iznini projenin sayfasından açabilirsiniz.`,
    );
    expect(whoReads(dialog)).toHaveTextContent(FOR_COMPANY);
    cleanup();

    mockApi(handlers(listOf(NO_AI, LANSMAN), sessionHandler(EMPLOYEE_SESSION)));
    await openList();
    dialog = await openForm();
    field = await projectField(dialog);
    expect(field).toHaveAccessibleDescription(
      `${HELP} ${CLOSED_HELP} Yapay zekâ iznini kurucu açar.`,
    );
    expect(dialog).not.toHaveTextContent(/projenin sayfasından açabilirsiniz/);
    cleanup();

    // Nothing offered is disabled: the second line is not shown.
    mockApi(handlers(listOf(LANSMAN)));
    await openList();
    dialog = await openForm();
    field = await projectField(dialog);
    expect(field).toHaveAccessibleDescription(HELP);
    expect(dialog).not.toHaveTextContent(CLOSED_HELP);
  });

  it('form: with no open project the field says so and the request is sent without one', async () => {
    const api = mockApi(handlers(listOf(CLOSED)));
    await openList();
    let dialog = await openForm();
    let field = await projectField(dialog);
    expect(labels(field)).toEqual(['Proje yok']);
    expect(field).toHaveAccessibleDescription('Bu şirkette açık proje yok.');
    expect(dialog).not.toHaveTextContent(HELP);
    await userEvent.type(textBox(dialog), 'Bir gönderi yaz');
    await userEvent.click(sendButton(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /requests')).toHaveLength(1);
    });
    // A request without a project carries no key for it.
    expect(api.callsTo('POST /requests')[0]?.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      text: 'Bir gönderi yaz',
    });
    cleanup();

    // An employee is offered the projects they are a member of.
    mockApi(handlers(listOf(), sessionHandler(EMPLOYEE_SESSION)));
    await openList();
    dialog = await openForm();
    field = await projectField(dialog);
    expect(field).toHaveAccessibleDescription('Üyesi olduğunuz açık proje yok.');
  });

  it('form: choosing a project changes who will read the request, and the request carries projectId; without a project no projectId key is sent', async () => {
    const api = mockApi(handlers(listOf(LANSMAN, CAGRI)));
    await openList();
    const dialog = await openForm();
    const field = await projectField(dialog);
    const notice = whoReads(dialog);
    expect(notice.textContent).toBe(FOR_COMPANY);
    // Said when it changes, and the text box stays described by it.
    expect(notice).toHaveAttribute('aria-live', 'polite');
    await userEvent.selectOptions(field, 'Lansman');
    expect(field).toHaveValue(PROJECT_ID);
    expect(notice.textContent).toBe(FOR_PROJECT);
    expect(textBox(dialog)).toHaveAccessibleDescription(new RegExp(`${FOR_PROJECT}$`));
    // Back to no project: the whole company reads it again, and the form says so.
    await userEvent.selectOptions(field, 'Proje yok');
    expect(notice.textContent).toBe(FOR_COMPANY);
    await userEvent.selectOptions(field, 'Lansman');
    await userEvent.type(textBox(dialog), 'Lansman duyurusu yaz');
    await userEvent.click(sendButton(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /requests')).toHaveLength(1);
    });
    expect(api.callsTo('POST /requests')[0]?.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      text: 'Lansman duyurusu yaz',
      projectId: PROJECT_ID,
    });
    // The record is what was sent: nothing more is said.
    expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
    expect(screen.queryByText(/ilk gönderdiğiniz hâliyle kayıtlı/)).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('form: the draft keeps the project; a kept project that is no longer offered is said and nothing is sent', async () => {
    let offered = [LANSMAN, CAGRI];
    const api = mockApi(handlers(() => json({ projects: offered, truncated: false })));
    await openList();
    let dialog = await openForm();
    await userEvent.selectOptions(await projectField(dialog), 'Lansman');
    await userEvent.type(textBox(dialog), 'Lansman duyurusu yaz');
    await closeForm();

    dialog = await openForm();
    let field = await projectField(dialog);
    expect(field).toHaveValue(PROJECT_ID);
    expect(textBox(dialog)).toHaveValue('Lansman duyurusu yaz');
    expect(whoReads(dialog)).toHaveTextContent(FOR_PROJECT);
    // A change of the project alone is kept too, with the text.
    await userEvent.selectOptions(field, 'Çağrı merkezi');
    await closeForm();
    dialog = await openForm();
    expect(await projectField(dialog)).toHaveValue(OTHER_ID);
    await userEvent.selectOptions(await projectField(dialog), 'Lansman');
    await closeForm();

    // Meanwhile the founder closed the project's AI permission: the option is there, disabled.
    offered = [{ ...LANSMAN, aiAllowed: false, agentsMayWork: false }, CAGRI];
    dialog = await openForm();
    field = await projectField(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(GONE);
    expect(field).toHaveValue(PROJECT_ID);
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(new RegExp(`${GONE.replace(/[".]/g, '.')}$`));
    const send = sendButton(dialog);
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).toHaveAccessibleDescription(GONE);
    await userEvent.click(send);
    await userEvent.click(textBox(dialog));
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(api.callsTo('POST /requests')).toHaveLength(0);
    // Nothing is lost.
    expect(textBox(dialog)).toHaveValue('Lansman duyurusu yaz');
    await closeForm();

    // And a project that was closed is no longer in the list at all: the field still shows what
    // was chosen, by its name, and says the same.
    offered = [CAGRI];
    dialog = await openForm();
    field = await projectField(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(GONE);
    expect(labels(field)).toEqual(['Proje yok', 'Çağrı merkezi', 'Lansman']);
    expect(field).toHaveValue(PROJECT_ID);
    // Another choice clears it, and the request goes where the person now chose.
    await userEvent.selectOptions(field, 'Proje yok');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(labels(field)).toEqual(['Proje yok', 'Çağrı merkezi']);
    expect(sendButton(dialog)).not.toHaveAttribute('aria-disabled');
    await userEvent.click(sendButton(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /requests')).toHaveLength(1);
    });
    expect(api.callsTo('POST /requests')[0]?.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      text: 'Lansman duyurusu yaz',
    });
  });

  it('form: a draft written before the form had a project, or with a project that cannot be read, keeps its text', async () => {
    mockApi(handlers(listOf(LANSMAN)));
    await openList();
    const key = draftKey(USER_ID, ARMADX.companyId, 'request');
    sessionStorage.setItem(key, JSON.stringify({ id: REQUEST_ID, text: 'Eski taslak' }));
    let dialog = await openForm();
    expect(textBox(dialog)).toHaveValue('Eski taslak');
    expect(await projectField(dialog)).toHaveValue('');
    await closeForm();
    sessionStorage.setItem(
      key,
      JSON.stringify({ id: REQUEST_ID, text: 'Bozuk projeli taslak', project: { id: 'x' } }),
    );
    dialog = await openForm();
    expect(textBox(dialog)).toHaveValue('Bozuk projeli taslak');
    expect(await projectField(dialog)).toHaveValue('');
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('form: the list being read and the list that failed, with a retry that works', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = mockApi(
      handlers(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    await openList();
    const dialog = await openForm();
    const field = within(dialog).getByRole('combobox', { name: 'Proje' });
    // Being read: the field is there (the form does not jump when the list arrives) and says so.
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute('aria-busy', 'true');
    expect(labels(field)).toEqual(['Projeler okunuyor']);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    // A request without a project does not wait for the list.
    expect(sendButton(dialog)).not.toHaveAttribute('aria-disabled');

    // The list could not be read: said, with a way to read it again; "Proje yok" stays.
    // A refusal the panel does not ask again by itself (a failure of the server is retried first).
    answer(apiError(409, 'invalid_request', 'Liste şu anda okunamadı.'));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(LIST_FAILED);
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute('aria-busy', 'false');
    expect(labels(field)).toEqual(['Proje yok']);
    expect(sendButton(dialog)).not.toHaveAttribute('aria-disabled');
    api.handle('GET /projects', listOf(LANSMAN));
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => {
      expect(labels(field)).toEqual(['Proje yok', 'Lansman']);
    });
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(api.callsTo('GET /projects')).toHaveLength(2);
  });

  it('form: with a project chosen nothing is sent before the list has said that it takes a request; when the list failed the API decides', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = mockApi(
      handlers(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    await openList();
    sessionStorage.setItem(
      draftKey(USER_ID, ARMADX.companyId, 'request'),
      JSON.stringify({
        id: REQUEST_ID,
        text: 'Lansman duyurusu yaz',
        dueDate: '',
        project: { id: PROJECT_ID, name: 'Lansman' },
      }),
    );
    const dialog = await openForm();
    const field = within(dialog).getByRole('combobox', { name: 'Proje' });
    // The field shows what is chosen, by the name the draft kept.
    expect(labels(field)).toEqual(['Projeler okunuyor', 'Lansman']);
    expect(field).toHaveValue(PROJECT_ID);
    const send = sendButton(dialog);
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).toHaveAccessibleDescription('Projeler okunuyor');
    await userEvent.click(send);
    expect(api.callsTo('POST /requests')).toHaveLength(0);

    // A refusal the panel does not ask again by itself (a failure of the server is retried first).
    answer(apiError(409, 'invalid_request', 'Liste şu anda okunamadı.'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(LIST_FAILED);
    expect(labels(field)).toEqual(['Proje yok', 'Lansman']);
    expect(field).toHaveValue(PROJECT_ID);
    expect(send).not.toHaveAttribute('aria-disabled');
    await userEvent.click(send);
    await waitFor(() => {
      expect(api.callsTo('POST /requests')).toHaveLength(1);
    });
    expect(api.callsTo('POST /requests')[0]?.body).toEqual({
      id: REQUEST_ID,
      text: 'Lansman duyurusu yaz',
      projectId: PROJECT_ID,
    });
  });

  it.each([
    {
      code: 'project_not_available' as const,
      message: 'Bu proje yok ya da size açık değil. Başka bir proje seçin.',
      after: [CAGRI],
    },
    {
      code: 'project_closed' as const,
      message: 'Bu proje kapalı. Kapalı projede yeni talep açılamaz.',
      after: [{ ...LANSMAN, status: 'completed' as const, closed: true }, CAGRI],
    },
    {
      code: 'project_ai_not_allowed' as const,
      message:
        'Bu projede talep açılamaz: projenin yapay zekâ izni kapalı. İzni kurucu, projenin sayfasından açar.',
      after: [{ ...LANSMAN, aiAllowed: false, agentsMayWork: false }, CAGRI],
    },
  ])(
    'form: a refusal of the API ($code) shows its sentence, keeps the text and reads the projects again',
    async ({ code, message, after }) => {
      let offered = [LANSMAN, CAGRI];
      const api = mockApi({
        ...handlers(() => json({ projects: offered, truncated: false })),
        'POST /requests': () => {
          // The project changed between the list and the send.
          offered = after;
          return apiError(409, code, message);
        },
      });
      await openList();
      const dialog = await openForm();
      const field = await projectField(dialog);
      await userEvent.selectOptions(field, 'Lansman');
      await userEvent.type(textBox(dialog), 'Lansman duyurusu yaz');
      await userEvent.click(sendButton(dialog));
      // The API's own sentence, in the form's alert.
      expect(await within(dialog).findByText(message)).toBeVisible();
      expect(textBox(dialog)).toHaveValue('Lansman duyurusu yaz');
      // The list is read again, and the field then says by itself that the project takes none.
      await waitFor(() => {
        expect(api.callsTo('GET /projects')).toHaveLength(2);
      });
      expect(await within(dialog).findByText(GONE)).toBeVisible();
      expect(field).toHaveValue(PROJECT_ID);
      expect(sendButton(dialog)).toHaveAttribute('aria-disabled', 'true');
      // The draft stays with the text and the project.
      await closeForm();
      const again = await openForm();
      expect(textBox(again)).toHaveValue('Lansman duyurusu yaz');
      expect(await projectField(again)).toHaveValue(PROJECT_ID);
    },
  );

  it('form: another refusal does not read the projects again', async () => {
    const api = mockApi({
      ...handlers(listOf(LANSMAN)),
      'POST /requests': () => apiError(500, 'internal_error', 'Beklenmeyen bir hata oluştu.'),
    });
    await openList();
    const dialog = await openForm();
    await userEvent.selectOptions(await projectField(dialog), 'Lansman');
    await userEvent.type(textBox(dialog), 'Lansman duyurusu yaz');
    await userEvent.click(sendButton(dialog));
    expect(await within(dialog).findByText('Beklenmeyen bir hata oluştu.')).toBeVisible();
    expect(api.callsTo('GET /projects')).toHaveLength(1);
    expect(within(dialog).queryByText(GONE)).toBeNull();
  });

  it('form: after a send whose answer was lost, a project chosen since is said not to have been taken', async () => {
    // The first send was stored without a project and its answer lost. The person then chose a
    // project: the API answers the first record, which the whole company reads.
    let stored: ReturnType<typeof storedFrom> | null = null;
    const api = mockApi({
      ...handlers(listOf(LANSMAN)),
      'POST /requests': (call) => {
        if (stored === null) {
          stored = storedFrom(call);
          throw new TypeError('Failed to fetch');
        }
        return json(stored, 201);
      },
      [`GET /requests/${REQUEST_ID}`]: () => json(stored),
    });
    await openList();
    const dialog = await openForm();
    const field = await projectField(dialog);
    await userEvent.type(textBox(dialog), 'Bir gönderi yaz');
    await userEvent.click(sendButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.',
    );
    await userEvent.selectOptions(field, 'Lansman');
    await userEvent.click(sendButton(dialog));
    expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
    expect(api.callsTo('POST /requests').map((call) => call.body)).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string, text: 'Bir gönderi yaz' },
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        text: 'Bir gönderi yaz',
        projectId: PROJECT_ID,
      },
    ]);
    expect(
      await screen.findByText(
        'Talep ilk gönderdiğiniz hâliyle kayıtlı; sonradan yaptığınız değişiklik alınmadı. Değiştirmek için bu talebi iptal edip yenisini gönderin.',
      ),
    ).toBeVisible();
  });

  // The button of a project's page opens the form through the second opener of the shell.
  it('form: opened from a project’s page the project is chosen, and the draft’s text is kept', async () => {
    function Opener() {
      const openFor = useOpenRequestDialogFor();
      const open = useOpenRequestDialog();
      return (
        <>
          <button type="button" onClick={() => openFor?.({ id: OTHER_ID, name: 'Çağrı merkezi' })}>
            Bu projede talep aç
          </button>
          <button type="button" onClick={open ?? undefined}>
            Yeni talep
          </button>
        </>
      );
    }
    mockApi(handlers(listOf(LANSMAN, CAGRI)));
    // A draft with another project: the page's project wins, the text stays.
    sessionStorage.setItem(
      draftKey(USER_ID, ARMADX.companyId, 'request'),
      JSON.stringify({
        id: REQUEST_ID,
        text: 'Yarım kalan metin',
        dueDate: '',
        project: { id: PROJECT_ID, name: 'Lansman' },
      }),
    );
    renderInRouter(
      <QueryClientProvider client={createQueryClient()}>
        <SessionContext value={sessionBody()}>
          <CompanyContext value={ARMADX}>
            <RequestDialogProvider>
              <Opener />
            </RequestDialogProvider>
          </CompanyContext>
        </SessionContext>
      </QueryClientProvider>,
    );
    const opener = await screen.findByRole('button', { name: 'Bu projede talep aç' });
    await userEvent.click(opener);
    let dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    // Before the list is read the field already shows the project, by the name the page gave.
    const early = within(dialog).getByRole('combobox', { name: 'Proje' });
    expect(early).toHaveValue(OTHER_ID);
    expect(within(early).getByRole('option', { name: 'Çağrı merkezi' })).toBeVisible();
    const field = await projectField(dialog);
    expect(field).toHaveValue(OTHER_ID);
    expect(textBox(dialog)).toHaveValue('Yarım kalan metin');
    expect(whoReads(dialog)).toHaveTextContent(FOR_PROJECT);
    await waitFor(() => {
      expect(textBox(dialog)).toHaveFocus();
    });
    // The focus goes back to the button that opened the form.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(opener).toHaveFocus();
    });
    // The plain opener presets nothing: the draft's own project is chosen.
    await userEvent.click(screen.getByRole('button', { name: 'Yeni talep' }));
    dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    expect(await projectField(dialog)).toHaveValue(PROJECT_ID);
  });
});

describe('Talepler with requests inside projects', () => {
  it('list: a row names its project from 1280 px and in its link’s name', async () => {
    const inProject = requestDetail({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      project: PROJECT_REF,
      dueDate: '2026-10-20',
    });
    const plain = requestDetail({
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Kasım bülteni',
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
    });
    const noDay = requestDetail({
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Ekim duyurusu',
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      project: PROJECT_REF,
    });
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () =>
        json({ requests: [inProject, plain, noDay].map(summaryOf), truncated: false }),
    });
    renderApp('/c/armadx/requests');
    const link = await screen.findByRole('link', { name: /^LinkedIn için gönderi yaz/ });
    // The name is said to a screen reader after the title, at every width.
    expect(link).toHaveAccessibleName(
      `LinkedIn için gönderi yaz, proje Lansman, Ajan çalışıyor, sıra SOS-2, Son tarih: ${formatDay('2026-10-20')}`,
    );
    const row = link.closest('li');
    if (!row) throw new Error('No row');
    const name = within(row).getByText('Lansman');
    // jsdom lays nothing out; the classes are the contract of the widths. Next to a due day the
    // name shows from 1440 px: at 1280 px the two marks together would leave the title no room.
    expect(name).toHaveClass('hidden', 'min-[1440px]:block', 'max-w-40', 'truncate');
    expect(name).not.toHaveClass('xl:block');
    // Under the row's link: a `title` attribute would never be shown.
    expect(name).not.toHaveAttribute('title');
    // The name stands before the due day, which keeps its own rule.
    expect(row.textContent).toMatch(/Lansman.*Son tarih:/);
    // Without a due day the name shows from 1280 px and gives way to the title below, like the
    // unit code and the time.
    const bare = screen.getByRole('link', { name: /^Ekim duyurusu/ }).closest('li');
    if (!bare) throw new Error('No row');
    expect(within(bare).getByText('Lansman')).toHaveClass('hidden', 'xl:block', 'max-w-40');
    expect(within(bare).getByText('Lansman')).not.toHaveClass('min-[1440px]:block');
    // A request without a project names none.
    const other = screen.getByRole('link', { name: /^Kasım bülteni/ });
    expect(other).toHaveAccessibleName('Kasım bülteni, Ajan çalışıyor, sıra SOS-2');
    expect(other.closest('li')).not.toHaveTextContent(/Lansman|proje/i);
    // Still a row of words: no control.
    expect(within(screen.getByRole('main')).queryAllByRole('combobox')).toEqual([]);
  });
});

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

// 8 October decision 45: a request whose requester can no longer read it (taken out of its
// project, made an external person, removed from the company, deactivated) goes on. The agent
// works in the founder's name and the founder gives the requester's approval in their place; the
// request stays the requester's on every page.
describe('a request that goes on in the founder’s name', () => {
  const ABSENT =
    'Talep sahibi bu talebi artık göremiyor. Talep sürer: ajan kurucunun adına çalışır, sonucu da talep sahibinin yerine kurucu onaylar.';
  const ABSENT_CLOSED = 'Talep sahibi bu talebi artık göremiyor.';
  const IN_PLACE =
    'Bu sonuca talep sahibi Ayşe Yılmaz yerine siz karar veriyorsunuz: talep sahibi talebi artık göremiyor.';
  const COLLEAGUE_SESSION = {
    user: { id: '99999999-9999-4999-8999-999999999999', name: 'Mehmet Demir' },
    memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
  };
  const working = {
    status: 'in_progress' as const,
    stage: 'working' as const,
    turn: { kind: 'agent' as const, code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
    waitingForMe: false,
    approval: null,
    project: PROJECT_REF,
  };
  /** The requester's approval waits, and the founder is the one who gives it. */
  const standIn = (overrides: Parameters<typeof requestDetail>[0] = {}) =>
    requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'founder' },
      waitingForMe: true,
      project: PROJECT_REF,
      requesterReads: false,
      approval: null,
      result: RESULT,
      acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: true },
      actions: { cancel: false, stop: true, reroute: true },
      ...overrides,
    });

  it('page: a request whose requester cannot read it says so to every reader, in the open and in the closed form', async () => {
    const open = requestDetail({ ...working, requesterReads: false });
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(open),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(ABSENT)).toBeVisible();
    // Who asked never changes: the page keeps naming the requester.
    expect(screen.getByText('Ayşe Yılmaz yazdı.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Yolculuk' })).toHaveTextContent(
      'Ayşe Yılmaz talebi gönderdi.',
    );
    cleanup();

    // Not only the founder: every reader of the page reads it.
    mockApi({
      'GET /session': sessionHandler(COLLEAGUE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json({ ...open, actions: { cancel: false, stop: false, reroute: false } }),
    });
    renderApp(REQUEST_PAGE);
    expect(await screen.findByText(ABSENT)).toBeVisible();
    cleanup();

    // Closed: nothing goes on any more, and the sentence does not say that it does.
    for (const closed of [
      { status: 'done' as const, stage: 'done' as const },
      {
        status: 'cancelled' as const,
        stage: 'cancelled' as const,
        cause: 'stopped' as const,
        closure: { by: FOUNDER, reason: null, note: 'Gerek kalmadı.' },
      },
    ]) {
      mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () =>
          json(
            requestDetail({
              ...closed,
              turn: { kind: 'none' },
              waitingForMe: false,
              approval: null,
              requesterReads: false,
              actions: { cancel: false, stop: false, reroute: false },
            }),
          ),
      });
      renderApp(REQUEST_PAGE);
      expect(await screen.findByText(ABSENT_CLOSED)).toBeVisible();
      expect(screen.getByRole('main')).not.toHaveTextContent(/Talep sürer|kurucunun adına/);
      cleanup();
    }

    // A requester who reads their request: nothing is said.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail(working)),
    });
    renderApp(REQUEST_PAGE);
    await screen.findByText('Ayşe Yılmaz yazdı.');
    expect(screen.getByRole('main')).not.toHaveTextContent(/artık göremiyor/);
  });

  it('page: the founder is offered the requester’s approval in their place, reads in whose place, and sends the same request', async () => {
    const done = requestDetail({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
      project: PROJECT_REF,
      requesterReads: false,
      approval: null,
      result: RESULT,
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(standIn()),
      [ACCEPTANCE]: () => json(done),
    });
    renderApp(REQUEST_PAGE);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    // The turn is the founder's, in the words every waiting result uses.
    expect(stageLine()).toContain('Aşama: Sonucu onaylamanız bekleniyor Sıra: sizde');
    expect(screen.getByText(ABSENT)).toBeVisible();
    // In whose place, above the question, and both buttons are described by it.
    const inPlace = within(card).getByText(IN_PLACE);
    expect(
      inPlace.compareDocumentPosition(within(card).getByText(/İstediğiniz buysa onaylayın/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const accept = within(card).getByRole('button', { name: 'Sonucu onayla' });
    const notThis = within(card).getByRole('button', { name: 'İstediğim bu değil' });
    expect(accept).toHaveAccessibleDescription(IN_PLACE);
    expect(notThis).toHaveAccessibleDescription(IN_PLACE);
    // The other answer is offered too ("karar veriyorsunuz"), with the dialog of every acceptance.
    await userEvent.click(notThis);
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(dialog).toHaveTextContent('aynı ajana bir kez geri döner');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // The same request as the requester's own answer: the API knows who answers.
    await userEvent.click(accept);
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Tamamlandı');
    });
    expect(api.callsTo(ACCEPTANCE).map((call) => call.body)).toEqual([{ decision: 'approved' }]);
    expect(screen.getByText(ABSENT_CLOSED)).toBeVisible();
    cleanup();

    // A requester who left the company has no name the founder can read: nobody is named. While
    // the permission is closed, "İstediğim bu değil" says both things.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          standIn({
            requester: { userId: EMPLOYEE.userId, name: null },
            agentsMayWork: false,
            acceptance: { round: 2, returnsToAgent: false, inPlaceOfRequester: true },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    const nameless = await screen.findByRole('region', { name: 'Sonuç hazır' });
    const NAMELESS =
      'Bu sonuca talep sahibinin yerine siz karar veriyorsunuz: talep sahibi talebi artık göremiyor.';
    expect(within(nameless).getByText(NAMELESS)).toBeVisible();
    expect(nameless).not.toHaveTextContent(/Eski üye/);
    expect(
      within(nameless).getByRole('button', { name: 'İstediğim bu değil' }),
    ).toHaveAccessibleDescription(`${NAMELESS} ${CHANGES_HELD}`);
    expect(
      within(nameless).getByRole('button', { name: 'Sonucu onayla' }),
    ).toHaveAccessibleDescription(NAMELESS);
    cleanup();

    // The founder was not the one who asked for changes the first time: the dialog does not say
    // "you asked before".
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          standIn({ acceptance: { round: 2, returnsToAgent: false, inPlaceOfRequester: true } }),
        ),
    });
    renderApp(REQUEST_PAGE);
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Sonuç hazır' })).getByRole('button', {
        name: 'İstediğim bu değil',
      }),
    );
    const second = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(second).toHaveTextContent(
      'Bu talepte daha önce düzeltme istendi: iş ajana kendiliğinden dönmez, kurucuya düşer.',
    );
    expect(second).not.toHaveTextContent(/istediniz/);
    cleanup();

    // The founder's own request: nothing is said about anybody's place.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          standIn({
            requester: FOUNDER,
            requesterReads: true,
            turn: { kind: 'person', ...FOUNDER },
            acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: false },
          }),
        ),
    });
    renderApp(REQUEST_PAGE);
    const own = await screen.findByRole('region', { name: 'Sonuç hazır' });
    expect(own).not.toHaveTextContent(/yerine/);
    expect(
      within(own).getByRole('button', { name: 'Sonucu onayla' }),
    ).not.toHaveAccessibleDescription();
    expect(
      within(own).getByRole('button', { name: 'İstediğim bu değil' }),
    ).not.toHaveAccessibleDescription();
  });

  it('Onaylar: a stand-in acceptance names the requester', async () => {
    const acceptance = (
      requestId: string,
      requestTitle: string,
      forRequester: { userId: string; name: string | null } | null,
    ) => ({
      requestId,
      requestTitle,
      round: 1,
      returnsToAgent: true,
      agentsMayWork: true,
      forRequester,
      openedAt: '2026-10-07T09:00:00.000Z',
      result: RESULT,
    });
    mockApi({
      'GET /session': sessionHandler(),
      'GET /approvals': () =>
        json({
          approvals: [],
          acceptances: [
            acceptance(REQUEST_ID, 'Lansman duyurusu', EMPLOYEE),
            acceptance('77777777-7777-4777-8777-777777777777', 'Kasım bülteni', null),
          ],
        }),
    });
    renderApp('/c/armadx/approvals');
    const results = await screen.findByRole('region', { name: /Taleplerinizin sonuçları/ });
    const [inPlace, own] = within(results).getAllByRole('region', { name: 'Sonuç hazır' });
    if (!inPlace || !own) throw new Error('Two acceptance cards were expected');
    expect(within(inPlace).getByText(IN_PLACE)).toBeVisible();
    expect(
      within(inPlace).getByRole('button', { name: 'Sonucu onayla' }),
    ).toHaveAccessibleDescription(IN_PLACE);
    // The founder's own request beside it says nothing of the kind.
    expect(own).not.toHaveTextContent(/yerine/);
    expect(
      within(own).getByRole('button', { name: 'Sonucu onayla' }),
    ).not.toHaveAccessibleDescription();
  });

  it('page: the journey says who answered in the requester’s place', async () => {
    const acceptance = (
      id: string,
      status: 'approved' | 'changes_requested',
      decidedBy: typeof FOUNDER | null,
      note: string | null = null,
    ) => ({
      kind: 'acceptance' as const,
      id,
      at: '2026-10-07T10:00:00.000Z',
      round: 1,
      status,
      decidedBy,
      reason: null,
      note,
    });
    const page = (journey: ReturnType<typeof acceptance>[]) =>
      requestDetail({
        ...working,
        requesterReads: false,
        journey: [...DEFAULT_JOURNEY, ...journey],
      });
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          page([
            // The requester's own answer, before they lost the request.
            acceptance(
              'c1111111-1111-4111-8111-111111111111',
              'changes_requested',
              null,
              'Kısa olsun.',
            ),
            // The founder's answers in their place.
            acceptance(
              'c2222222-2222-4222-8222-222222222222',
              'changes_requested',
              FOUNDER,
              'Daha resmî.',
            ),
            acceptance('c3333333-3333-4333-8333-333333333333', 'approved', FOUNDER),
          ]),
        ),
    });
    renderApp(REQUEST_PAGE);
    const journey = await screen.findByRole('region', { name: 'Yolculuk' });
    const lines = within(journey)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
      .slice(-3);
    expect(lines[0]).toContain('Ayşe Yılmaz "istediğim bu değil" dedi.Kısa olsun.');
    expect(lines[1]).toContain('Ömer Kadıoğlu, talep sahibinin yerine düzeltme istedi.Daha resmî.');
    expect(lines[2]).toContain('Ömer Kadıoğlu, talep sahibinin yerine onayladı.');
    // The record never says that the requester answered what the founder answered.
    expect(lines[1]).not.toContain('Ayşe Yılmaz');
    expect(lines[2]).not.toContain('Ayşe Yılmaz');
    expect(journey).not.toHaveTextContent('Ayşe Yılmaz sonucu onayladı.');
  });
});
