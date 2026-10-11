import { stepUpOptionsRequestSchema, type ProjectDetail } from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMIT_REACHED, NO_REQUEST_AT_LIMIT } from './lib/projects/labels.ts';
import { approvalDeskKey, requestKey } from './lib/requests/query.ts';
import { sidebarCountsKey, todayKey } from './lib/today/query.ts';
import { apiError, ARMADX, json, mockApi, type Handler } from './test/mock-api.ts';
import { ASSERTION, signed, stepUpIssuer } from './test/passkeys.ts';
import {
  EMPLOYEE_AT_ARMADX,
  project,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  projectRun,
  projectRuns,
  projectRunsRoute,
  sessionAs,
  waitingWorkRoute,
} from './test/project-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

// The AI spending limit of a project (8 October decision 17) on the project's own screens: what
// every reader is told when it is reached, and the founder's block on the "Çalışmalar" tab.

// The browser's passkey prompt: the founder confirms, unless a test says otherwise.
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
});

const LIST = '/c/armadx/projects';
const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const RUNS_TAB = `${PATH}?tab=runs`;

/** A project where agents may work, open for requests. */
const OPEN = { aiAllowed: true, agentsMayWork: true, customer: null };

function listOf(...projects: ReturnType<typeof project>[]): Handler {
  return () => json({ projects, truncated: false });
}

describe('projects: a reached AI spending limit, for every reader', () => {
  it('limit: a member sees no figure, and the banner above the tabs when the limit is reached', async () => {
    mockApi(
      projectHandlers(projectForEmployee({ ...OPEN, spendingLimitReached: true }), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [projectRunsRoute()]: () => json(projectRuns([projectRun()])),
      }),
    );
    renderApp(RUNS_TAB);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const banner = screen.getByText(LIMIT_REACHED.others);
    expect(banner).toBeVisible();
    // Above the tabs: it is said on every tab of the page.
    const tabs = screen.getByRole('tablist', { name: 'Proje bölümleri' });
    expect(banner.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(LIMIT_REACHED.founder)).toBeNull();
    // The member learns that the limit is reached, and nothing of the money: no block, no
    // figure, no button on the "Çalışmalar" tab.
    const panel = await screen.findByRole('tabpanel', { name: 'Çalışmalar' });
    await within(panel).findByRole('table');
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/\$|Harcanan|Kalan|Sınır belirle/);
    cleanup();

    // The founder is told where the limit is raised.
    mockApi(
      projectHandlers(
        projectDetail({
          ...OPEN,
          spendingLimitReached: true,
          aiSpending: { limitUsd: '25.00', spentUsd: '25.004100' },
          actions: { ...projectDetail().actions, setAiSpendingLimit: true },
        }),
      ),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(screen.getByText(LIMIT_REACHED.founder)).toBeVisible();
    expect(screen.queryByText(LIMIT_REACHED.others)).toBeNull();
    cleanup();

    // A limit that is not reached is not mentioned to anybody on the page's head.
    mockApi(
      projectHandlers(projectForEmployee(OPEN), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/harcama sınırı/);
  });

  it('the project list says Harcama sınırı doldu for such a project', async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': listOf(
          project({ ...OPEN, name: 'Lansman', spendingLimitReached: true }),
          project({
            ...OPEN,
            id: 'a2222222-2222-4222-8222-222222222222',
            name: 'Çağrı merkezi',
          }),
          // The permission is said first: while it is closed the limit changes nothing.
          project({
            id: 'a3333333-3333-4333-8333-333333333333',
            name: 'Depo otomasyonu',
            spendingLimitReached: true,
          }),
        ),
      }),
    );
    renderApp(LIST);
    const row = (name: string) => {
      const item = screen.getByRole('link', { name: new RegExp(`^${name}\\.`) }).closest('li');
      if (!item) throw new Error(`No row for ${name}`);
      return item;
    };
    await screen.findByRole('link', { name: /^Lansman\./ });
    const atLimit = within(row('Lansman')).getByText('Harcama sınırı doldu');
    expect(atLimit).toBeVisible();
    expect(atLimit.className).toContain('text-ink-secondary');
    const free = within(row('Çağrı merkezi')).getByText('Ajanlar çalışabilir');
    expect(free.className).not.toContain('text-ink-secondary');
    expect(within(row('Depo otomasyonu')).getByText('Ajanlar çalışamaz')).toBeVisible();
    expect(row('Depo otomasyonu')).not.toHaveTextContent('Harcama sınırı doldu');
    // The row's link says the same.
    expect(screen.getByRole('link', { name: /^Lansman\./ })).toHaveAccessibleName(
      /Harcama sınırı doldu\./,
    );
  });

  it('the Talepler tab does not offer a new request in a project at its limit', async () => {
    mockApi(projectHandlers(projectDetail({ ...OPEN, spendingLimitReached: true })));
    renderApp(PATH);
    const panel = await screen.findByRole('tabpanel', { name: 'Talepler' });
    await within(panel).findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(within(panel).getByText(NO_REQUEST_AT_LIMIT.founder)).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Bu projede talep aç' })).toBeNull();
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee({ ...OPEN, spendingLimitReached: true }), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      }),
    );
    renderApp(PATH);
    const other = await screen.findByRole('tabpanel', { name: 'Talepler' });
    await within(other).findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(within(other).getByText(NO_REQUEST_AT_LIMIT.others)).toBeVisible();
    expect(within(other).queryByRole('button', { name: 'Bu projede talep aç' })).toBeNull();
    cleanup();

    // A closed AI permission is the reason that is said when both hold.
    mockApi(
      projectHandlers(
        projectDetail({ aiAllowed: false, agentsMayWork: false, spendingLimitReached: true }),
      ),
    );
    renderApp(PATH);
    const both = await screen.findByRole('tabpanel', { name: 'Talepler' });
    await within(both).findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(both).toHaveTextContent('Bu projede ajanlar çalışamadığı için talep açılamaz.');
    expect(both).not.toHaveTextContent('harcama sınırı');
    cleanup();

    // With the limit not reached the button is there.
    mockApi(projectHandlers(projectDetail(OPEN)));
    renderApp(PATH);
    const free = await screen.findByRole('tabpanel', { name: 'Talepler' });
    expect(await within(free).findByRole('button', { name: 'Bu projede talep aç' })).toBeVisible();
  });
});

describe('projects: the founder and the AI spending limit', () => {
  const LIMIT = `PUT /projects/${PROJECT_ID}/ai-spending-limit`;
  const PAID = 'her biri ücretli bir yapay zekâ çalışmasıdır.';

  /** The fixture's project as the founder reads it, with what was spent and the limit. */
  function withSpending(
    limitUsd: string | null,
    spentUsd: string,
    spendingLimitReached = false,
  ): ProjectDetail {
    const base = projectDetail({ ...OPEN, spendingLimitReached });
    return {
      ...base,
      aiSpending: { limitUsd, spentUsd },
      actions: { ...base.actions, setAiSpendingLimit: true },
    };
  }
  /** The answer of a change of the limit. */
  const answer = (project: ProjectDetail, restarted = 0) => json({ ...project, restarted });

  const block = () => screen.findByRole('region', { name: 'Yapay zekâ harcaması' });
  const figure = (within_: HTMLElement, name: string) =>
    within(within_).getByText(name, { selector: 'dt' }).nextElementSibling;
  /** The state line of the block: its own live region. */
  const stateLine = (within_: HTMLElement) => within(within_).getByRole('status');
  const openForm = async (name: 'Sınır belirle' | 'Sınırı değiştir') => {
    await userEvent.click(within(await block()).getByRole('button', { name }));
    return screen.findByRole('dialog', { name: 'Yapay zekâ harcama sınırı' });
  };
  const field = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: 'Sınır (ABD doları)' });
  const noDialog = async () => {
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  };
  const toasts = () => screen.getByRole('region', { name: 'Anlık bildirimler' });
  /** The line of the confirmation that says how many requests will start. */
  const countLine = (dialog: HTMLElement): HTMLElement => {
    const line = dialog.querySelector<HTMLElement>('span[role="status"]');
    if (!line) throw new Error('No count line');
    return line;
  };
  const ready = async (button: HTMLElement) => {
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled');
    });
    return button;
  };

  it('limit: the founder sees what was spent, the limit, what is left and one of four state sentences', async () => {
    const cases: [
      ProjectDetail,
      { spent: string; limit: string; left: string | null; line: string },
    ][] = [
      [
        withSpending(null, '1.674690'),
        { spent: '$1,67', limit: 'Sınır yok', left: null, line: 'Bu projede harcama sınırı yok.' },
      ],
      [
        withSpending('25.00', '1.674690'),
        { spent: '$1,67', limit: '$25,00', left: '$23,33', line: 'Harcama, sınırın altında.' },
      ],
      [
        // Exactly 80 percent: the state begins there.
        withSpending('25.00', '20.000000'),
        {
          spent: '$20,00',
          limit: '$25,00',
          left: '$5,00',
          line: "Harcama, sınırın yüzde 80'ine ulaştı.",
        },
      ],
      [
        // Reached is the server's word; the sum has passed the limit by a call in flight.
        withSpending('25.00', '25.004100', true),
        {
          spent: '$25,00',
          limit: '$25,00',
          left: '$0,00',
          line: 'Harcama sınırı doldu: ajanlar bu projede yeni çalışma başlatmıyor.',
        },
      ],
    ];
    for (const [project, shown] of cases) {
      mockApi(projectHandlers(project));
      renderApp(RUNS_TAB);
      const section = await block();
      expect(figure(section, 'Harcanan')).toHaveTextContent(shown.spent);
      expect(figure(section, 'Sınır')).toHaveTextContent(shown.limit);
      if (shown.left === null) {
        expect(within(section).queryByText('Kalan')).toBeNull();
      } else {
        expect(figure(section, 'Kalan')).toHaveTextContent(shown.left);
      }
      expect(stateLine(section)).toHaveTextContent(shown.line);
      expect(
        within(section).getByRole('button', {
          name: project.aiSpending?.limitUsd === null ? 'Sınır belirle' : 'Sınırı değiştir',
        }),
      ).toBeVisible();
      cleanup();
    }

    // The block is above the list in every state of the list: also when there is no run yet.
    mockApi(projectHandlers(withSpending(null, '0')));
    renderApp(RUNS_TAB);
    const section = await block();
    const panel = screen.getByRole('tabpanel', { name: 'Çalışmalar' });
    const empty = await within(panel).findByRole('heading', {
      name: 'Bu projede henüz ajan çalışması yok',
    });
    expect(section.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(figure(section, 'Harcanan')).toHaveTextContent('$0,00');
  });

  it('limit: the 80 percent and the reached lines are said in words and carry the text tones text-status-open-text and text-status-error-text', async () => {
    const tone = async (project: ProjectDetail) => {
      mockApi(projectHandlers(project));
      renderApp(RUNS_TAB);
      const line = stateLine(await block());
      const classes = line.className.split(' ').filter((name) => name.startsWith('text-status-'));
      const text = line.textContent;
      cleanup();
      return { classes, text };
    };
    expect(await tone(withSpending('25.00', '19.999999'))).toEqual({
      classes: [],
      text: 'Harcama, sınırın altında.',
    });
    expect(await tone(withSpending('25.00', '20.00'))).toEqual({
      classes: ['text-status-open-text'],
      text: "Harcama, sınırın yüzde 80'ine ulaştı.",
    });
    expect(await tone(withSpending('25.00', '25.00', true))).toEqual({
      classes: ['text-status-error-text'],
      text: 'Harcama sınırı doldu: ajanlar bu projede yeni çalışma başlatmıyor.',
    });
    expect(await tone(withSpending(null, '900'))).toEqual({
      classes: [],
      text: 'Bu projede harcama sınırı yok.',
    });
  });

  it('limit: a first and a lower limit are sent without a passkey', async () => {
    let project = withSpending(null, '1.674690');
    const api = mockApi(
      projectHandlers(project, {
        [`GET /projects/${PROJECT_ID}`]: () => json(project),
        [LIMIT]: (call) => {
          const { limitUsd } = call.body as { limitUsd: string | null };
          project = withSpending(limitUsd, '1.674690');
          return answer(project);
        },
      }),
    );
    const { queryClient } = renderApp(RUNS_TAB);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    let dialog = await openForm('Sınır belirle');
    expect(dialog).toHaveTextContent(
      'Bu projedeki ajan çalışmalarının kayıtlı maliyeti bu tutara ulaşınca ajanlar bu projede durur: yeni çalışma başlamaz, süren çalışma bir sonraki adımında biter. Sınır projenin bütün ömrü için geçerlidir.',
    );
    expect(dialog).toHaveTextContent('Şimdiye kadar harcanan: $1,67.');
    expect(field(dialog)).toHaveFocus();
    expect(field(dialog)).toHaveValue('');
    expect(field(dialog)).toHaveAttribute('inputmode', 'decimal');
    expect(field(dialog)).toHaveAccessibleDescription('Örnek: 25,00');
    // No limit yet: nothing to take away.
    expect(within(dialog).queryByRole('button', { name: 'Sınırı kaldır' })).toBeNull();

    // A first limit: Enter sends it at once.
    await userEvent.type(field(dialog), '50{Enter}');
    await noDialog();
    expect(api.callsTo(LIMIT).map((call) => call.body)).toEqual([{ limitUsd: '50.00' }]);
    expect(await within(toasts()).findByText('Harcama sınırı kaydedildi.')).toBeVisible();
    // The page shows the answer without asking again, and the focus is back on the button.
    const section = await block();
    expect(figure(section, 'Sınır')).toHaveTextContent('$50,00');
    expect(figure(section, 'Kalan')).toHaveTextContent('$48,33');
    await waitFor(() => {
      expect(within(section).getByRole('button', { name: 'Sınırı değiştir' })).toHaveFocus();
    });
    // The stage of the project's open requests has just changed: everything that shows a
    // request reads again, and so do the runs of the project.
    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    for (const key of [
      ['company', ARMADX.companyId, 'project', PROJECT_ID, 'runs'],
      ['company', ARMADX.companyId, 'projects'],
      ['company', ARMADX.companyId, 'requests'],
      requestKey(ARMADX.companyId, 'x').slice(0, 3),
      todayKey(ARMADX.companyId),
      sidebarCountsKey(ARMADX.companyId),
      approvalDeskKey(ARMADX.companyId),
    ]) {
      expect(invalidated).toContainEqual(key);
    }

    // A lower limit: the form opens with the saved limit as a person types it, and sends at once.
    dialog = await openForm('Sınırı değiştir');
    expect(field(dialog)).toHaveValue('50,00');
    expect(within(dialog).getByRole('button', { name: 'Sınırı kaldır' })).toBeVisible();
    await userEvent.clear(field(dialog));
    await userEvent.type(field(dialog), '20,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await noDialog();
    expect(api.callsTo(LIMIT).map((call) => call.body)).toEqual([
      { limitUsd: '50.00' },
      { limitUsd: '20.50' },
    ]);
    expect(figure(await block(), 'Sınır')).toHaveTextContent('$20,50');
    // No passkey was asked for, no count was read, and nothing was said to have started.
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(api.calls.some((call) => call.path.startsWith('/waiting-work'))).toBe(false);
    expect(within(toasts()).queryByText(/yeniden başlatıldı/)).toBeNull();

    // Vazgeç and Escape send nothing and return the focus.
    dialog = await openForm('Sınırı değiştir');
    await userEvent.clear(field(dialog));
    await userEvent.type(field(dialog), '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await noDialog();
    await waitFor(async () => {
      expect(within(await block()).getByRole('button', { name: 'Sınırı değiştir' })).toHaveFocus();
    });
    expect(api.callsTo(LIMIT)).toHaveLength(2);
  });

  it('limit: a raise and a removal ask for the passkey and say how many requests will start before it is asked for', async () => {
    const stepUp = stepUpIssuer();
    let project = withSpending('25.00', '25.004100', true);
    let release: (response: Response) => void = () => undefined;
    const RAISE_COUNT = waitingWorkRoute({ spendingLimit: PROJECT_ID, limitUsd: '60.00' });
    const REMOVE_COUNT = waitingWorkRoute({ spendingLimit: PROJECT_ID });
    const api = mockApi(
      projectHandlers(project, {
        'POST /step-up/options': stepUp.handler,
        [`GET /projects/${PROJECT_ID}`]: () => json(project),
        [RAISE_COUNT]: () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
        [REMOVE_COUNT]: () => json({ waiting: 0 }),
        [LIMIT]: (call) => {
          const { limitUsd } = call.body as { limitUsd: string | null };
          project = withSpending(limitUsd, '25.004100');
          return answer(project, limitUsd === null ? 0 : 3);
        },
      }),
    );
    renderApp(RUNS_TAB);
    let form = await openForm('Sınırı değiştir');
    await userEvent.clear(field(form));
    await userEvent.type(field(form), '60');
    const behind = vi.spyOn(
      screen.getByRole('button', { name: 'Sınırı değiştir', hidden: true }),
      'focus',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    // The form gives way to the confirmation; nothing was sent by the form.
    let confirmation = await screen.findByRole('alertdialog', {
      name: 'Harcama sınırı yükseltilsin mi?',
    });
    // The closing form does not pull the focus back to the button behind the confirmation.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(behind).not.toHaveBeenCalled();
    behind.mockRestore();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo(LIMIT)).toEqual([]);
    expect(confirmation).toHaveTextContent(
      'Sınır $25,00 yerine $60,00 olacak; ajanlar bu projede daha fazla harcayabilir.',
    );
    // The focus is in the confirmation, not back on the button behind it.
    expect(confirmation).toContainElement(document.activeElement as HTMLElement);
    // The count is asked for the limit that is being confirmed, with two decimals.
    expect(countLine(confirmation)).toHaveTextContent('Bekleyen talepler sayılıyor.');
    expect(api.callsTo(RAISE_COUNT)).toHaveLength(1);
    // The passkey is for this project and this value.
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    expect(stepUpOptionsRequestSchema.parse(stepUp.issued[0]?.body)).toEqual({
      purpose: 'project_ai_spending_limit',
      companyId: ARMADX.companyId,
      subjectId: PROJECT_ID,
      details: { action: 'set_limit', limitUsd: '60.00' },
    });
    // The passkey is ready and the number is not: the button waits, and a press asks for no
    // passkey and sends nothing.
    let confirm = within(confirmation).getByRole('button', { name: 'Sınırı yükselt' });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(confirm);
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(api.callsTo(LIMIT)).toEqual([]);
    release(json({ waiting: 3 }));
    await waitFor(() => {
      expect(countLine(confirmation).textContent).toBe(
        `Bu projede 3 talep bekliyor. Sınırı yükseltince 3 talebin çalışması hemen yeniden başlar; ${PAID}`,
      );
    });
    // 11 October decision 1: nothing says any more that the work has to be given again by hand.
    expect(confirmation).not.toHaveTextContent(/kendiliğinden başlamaz|Yönlendirmeyi düzelt/);
    await userEvent.click(await ready(confirm));
    await noDialog();
    expect(api.callsTo(LIMIT).map((call) => call.body)).toEqual([
      { limitUsd: '60.00', stepUp: signed(stepUp.issued[0]?.challengeId ?? '') },
    ]);
    // One message says what was stored and how many requests the raise started again.
    expect(
      await within(toasts()).findByText(
        'Harcama sınırı kaydedildi. Bekleyen 3 talebin çalışması yeniden başlatıldı.',
      ),
    ).toBeVisible();
    let section = await block();
    expect(figure(section, 'Sınır')).toHaveTextContent('$60,00');
    // The banner above the tabs is gone with the answer.
    expect(screen.queryByText(LIMIT_REACHED.founder)).toBeNull();
    await waitFor(() => {
      expect(within(section).getByRole('button', { name: 'Sınırı değiştir' })).toHaveFocus();
    });

    // A confirmation that is given up sends nothing and returns the focus to the button.
    form = await openForm('Sınırı değiştir');
    await userEvent.click(within(form).getByRole('button', { name: 'Sınırı kaldır' }));
    confirmation = await screen.findByRole('alertdialog', {
      name: 'Harcama sınırı kaldırılsın mı?',
    });
    expect(confirmation).toHaveTextContent('Bu projede ajanların harcaması için sınır kalmayacak.');
    await waitFor(() => {
      expect(countLine(confirmation).textContent).toBe(
        'Bu projede yeniden başlayacak talep yok; sınırı kaldırmak hiçbir çalışmayı başlatmaz.',
      );
    });
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Vazgeç' }));
    await noDialog();
    expect(api.callsTo(LIMIT)).toHaveLength(1);
    await waitFor(async () => {
      expect(within(await block()).getByRole('button', { name: 'Sınırı değiştir' })).toHaveFocus();
    });

    // The removal: its own passkey, for no value; the count is asked without a limit.
    form = await openForm('Sınırı değiştir');
    await userEvent.click(within(form).getByRole('button', { name: 'Sınırı kaldır' }));
    confirmation = await screen.findByRole('alertdialog', {
      name: 'Harcama sınırı kaldırılsın mı?',
    });
    await waitFor(() => {
      expect(stepUp.issued.length).toBeGreaterThanOrEqual(3);
    });
    const last = stepUp.issued.at(-1);
    expect(stepUpOptionsRequestSchema.parse(last?.body)).toEqual({
      purpose: 'project_ai_spending_limit',
      companyId: ARMADX.companyId,
      subjectId: PROJECT_ID,
      details: { action: 'set_limit', limitUsd: null },
    });
    confirm = within(confirmation).getByRole('button', { name: 'Sınırı kaldır' });
    await userEvent.click(await ready(confirm));
    await noDialog();
    expect(api.callsTo(LIMIT).at(-1)?.body).toEqual({
      limitUsd: null,
      stepUp: signed(last?.challengeId ?? ''),
    });
    expect(await within(toasts()).findByText('Harcama sınırı kaldırıldı.')).toBeVisible();
    section = await block();
    expect(figure(section, 'Sınır')).toHaveTextContent('Sınır yok');
    expect(within(section).getByRole('button', { name: 'Sınır belirle' })).toBeVisible();
    expect(api.callsTo(REMOVE_COUNT).length).toBeGreaterThanOrEqual(2);
    expect(api.unexpected).toEqual([]);
  });

  it('limit: a count that could not be read is said and does not block the raise; a refusal stays in the confirmation', async () => {
    const stepUp = stepUpIssuer();
    const project = withSpending('25.00', '25.004100', true);
    const COUNT = waitingWorkRoute({ spendingLimit: PROJECT_ID, limitUsd: '40.00' });
    const api = mockApi(
      projectHandlers(project, {
        'POST /step-up/options': stepUp.handler,
        [COUNT]: () => apiError(500, 'internal_error', 'Beklenmeyen bir hata oluştu.'),
        [LIMIT]: () => apiError(403, 'founder_only', 'Bu işlemi yalnızca kurucu yapabilir.'),
      }),
    );
    renderApp(RUNS_TAB);
    const form = await openForm('Sınırı değiştir');
    await userEvent.clear(field(form));
    await userEvent.type(field(form), '40');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Harcama sınırı yükseltilsin mi?',
    });
    await waitFor(() => {
      expect(countLine(confirmation).textContent).toBe(
        `Bekleyen talepler sayılamadı. Bu projede bekleyen talep varsa sınırı yükseltince hemen yeniden başlar; ${PAID}`,
      );
    });
    const confirm = within(confirmation).getByRole('button', { name: 'Sınırı yükselt' });
    await userEvent.click(await ready(confirm));
    // The API's refusal is read in the confirmation, which stays; nothing changed on the page.
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      'Bu işlemi yalnızca kurucu yapabilir.',
    );
    expect(api.callsTo(LIMIT)).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(within(toasts()).queryByText('Harcama sınırı kaydedildi.')).toBeNull();
  });

  it('limit: a value at or under what was spent warns before it is saved', async () => {
    const WARNING =
      'Bu tutar şimdiye kadar harcanandan büyük değil: kaydedince ajanlar bu projede hemen durur.';
    const api = mockApi(
      projectHandlers(withSpending(null, '12.500000'), {
        [LIMIT]: () => answer(withSpending('12.50', '12.500000', true)),
      }),
    );
    renderApp(RUNS_TAB);
    const dialog = await openForm('Sınır belirle');
    // The warning line is a live region that is in the dialog from the start, empty.
    const warning = within(dialog)
      .getAllByRole('status')
      .find((line) => line.className.includes('text-status-open-text'));
    if (!warning) throw new Error('No warning line');
    expect(warning).toBeEmptyDOMElement();
    await userEvent.type(field(dialog), '12,51');
    expect(warning).toBeEmptyDOMElement();
    // Exactly what was spent is reached at once too.
    await userEvent.clear(field(dialog));
    await userEvent.type(field(dialog), '12,5');
    expect(warning).toHaveTextContent(WARNING);
    await userEvent.clear(field(dialog));
    await userEvent.type(field(dialog), '3');
    expect(warning).toHaveTextContent(WARNING);
    // A warning, not a refusal: it is the founder's to stop the agents now.
    await userEvent.clear(field(dialog));
    await userEvent.type(field(dialog), '12,50{Enter}');
    await noDialog();
    expect(api.callsTo(LIMIT).map((call) => call.body)).toEqual([{ limitUsd: '12.50' }]);
    expect(await screen.findByText(LIMIT_REACHED.founder)).toBeVisible();
  });

  it('limit: the amount is read the Turkish way and refused with its sentence', async () => {
    const api = mockApi(projectHandlers(withSpending('25.00', '1.00')));
    renderApp(RUNS_TAB);
    const dialog = await openForm('Sınırı değiştir');
    const input = field(dialog);
    await userEvent.clear(input);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      expect(input).toHaveAccessibleDescription('Örnek: 25,00 Sınırı yazın.');
    });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    const SHAPE = 'Sınırı 25,00 biçiminde yazın; sıfırdan büyük ve en çok 999.999,99 olmalı.';
    // A dot is not the decimal sign; zero is no limit; a million is too much.
    for (const wrong of ['12.5', '0', '1000000']) {
      await userEvent.clear(input);
      await userEvent.type(input, wrong);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
      await waitFor(() => {
        expect(input).toHaveAccessibleDescription(`Örnek: 25,00 ${SHAPE}`);
      });
    }
    expect(api.callsTo(LIMIT)).toEqual([]);
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('limit: when the limit was lowered elsewhere meanwhile the form closes, says so and the project is read again', async () => {
    const api = mockApi(
      projectHandlers(withSpending('25.00', '1.00'), {
        [LIMIT]: () =>
          apiError(403, 'step_up_required', 'Bu işlem için passkey ile doğrulama gerekiyor.'),
      }),
    );
    renderApp(RUNS_TAB);
    const dialog = await openForm('Sınırı değiştir');
    await userEvent.clear(field(dialog));
    await userEvent.type(field(dialog), '20');
    // The page still shows 25: a lower limit, sent at once. The limit is 10 by now.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(withSpending('10.00', '1.00')));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Sınır az önce değişti. Yeniden deneyin.')).toBeVisible();
    await noDialog();
    expect(figure(await block(), 'Sınır')).toHaveTextContent('$10,00');
    expect(api.callsTo(LIMIT).map((call) => call.body)).toEqual([{ limitUsd: '20.00' }]);

    // Another refusal is read in the form, which stays.
    api.handle(LIMIT, () => apiError(409, 'invalid_request', 'Sınır şu anda değiştirilemiyor.'));
    const again = await openForm('Sınırı değiştir');
    await userEvent.clear(field(again));
    await userEvent.type(field(again), '5');
    await userEvent.click(within(again).getByRole('button', { name: 'Kaydet' }));
    expect(await within(again).findByRole('alert')).toHaveTextContent(
      'Sınır şu anda değiştirilemiyor.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});
