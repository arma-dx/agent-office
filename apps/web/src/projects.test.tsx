import {
  createProjectSchema,
  PROJECT_COLORS,
  PROJECT_ICONS,
  stepUpOptionsRequestSchema,
} from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { focusManager } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProjectTile } from './components/projects/project-tile.tsx';
import { formatDay, formatFull } from './lib/dates.ts';
import {
  COLOR_NAME,
  ICON_NAME,
  MEMBERS_TEXT,
  PROJECT_FILL,
  PROJECT_ICON,
} from './lib/projects/labels.ts';
import { WIDE_WINDOW_QUERY } from './lib/office/use-wide-window.ts';
import { stubMatchMedia } from './test/match-media.ts';
import {
  apiError,
  ARMADX,
  FOUNDER_SPACE,
  json,
  mockApi,
  sessionHandler,
  type Handler,
} from './test/mock-api.ts';
import {
  AYSE,
  CAGAN,
  CANDIDATES,
  CUSTOMER_ID,
  CUSTOMER_NAMES,
  CUSTOMERS,
  EMPLOYEE_AT_ARMADX,
  EXTERNAL_AT_ARMADX,
  FOUNDER_MEMBER,
  OTHER_CUSTOMER_ID,
  project,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  projectWithRoles,
  roleHandlers,
  roleRoute,
  sessionAs,
  type MemberOfProject,
} from './test/project-fixtures.ts';
import {
  ASSERTION,
  cancelledByPerson,
  challengeId,
  signed,
  stepUpIssuer,
} from './test/passkeys.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
});

afterEach(() => {
  focusManager.setFocused(undefined);
});

const LIST = '/c/armadx/projects';
const PAGE = `/c/armadx/projects/${PROJECT_ID}`;

function listOf(...projects: ReturnType<typeof project>[]): Handler {
  return () => json({ projects, truncated: false });
}

/** The value beside a name in a list of properties. */
function valueOf(container: HTMLElement, name: string): HTMLElement {
  const value = within(container).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`No value beside ${name}`);
  return value;
}

/** The person comes back to the tab: what the page shows is read again. */
function comeBackToTheTab() {
  focusManager.setFocused(false);
  focusManager.setFocused(true);
}

/** The properties panel of the shell; it shows by itself in a wide window. */
function panel() {
  return screen.getByRole('complementary', { name: 'Özellikler' });
}

describe('projects: the menu', () => {
  const work = async () =>
    within(await screen.findByRole('navigation', { name: 'Ana menü' })).getByRole('list', {
      name: 'İş',
    });
  const rows = (list: HTMLElement) =>
    within(list)
      .getAllByRole('link')
      .map((link) => link.textContent);

  it('menu: Projeler is in the İş group after Notlar for a founder and for an employee', async () => {
    mockApi(projectHandlers());
    const { router } = renderApp('/c/armadx');
    expect(rows(await work())).toEqual(['Talepler', 'Görevler', 'Notlar', 'Projeler']);
    const row = within(await work()).getByRole('link', { name: 'Projeler' });
    expect(row).toHaveAttribute('href', LIST);
    await userEvent.click(row);
    expect(await screen.findByRole('heading', { level: 1, name: 'Projeler' })).toBeVisible();
    expect(row).toHaveAttribute('aria-current', 'page');
    // The row stays selected on a project's page.
    await router.navigate({ to: PAGE as never });
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(within(await work()).getByRole('link', { name: 'Projeler' })).toHaveAttribute(
      'data-status',
      'active',
    );
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp('/c/armadx');
    expect(rows(await work())).toEqual(['Talepler', 'Görevler', 'Notlar', 'Projeler']);
  });

  it('menu: Projeler is not offered to an external person, and not in Kurucu alanı', async () => {
    mockApi({ 'GET /session': sessionAs(EXTERNAL_AT_ARMADX) });
    renderApp('/c/armadx');
    expect(rows(await work())).toEqual(['Görevler', 'Notlar']);
    cleanup();

    // No project is opened in the founder's private space: the row would lead nowhere.
    mockApi({ 'GET /session': sessionHandler() });
    renderApp(`/c/${FOUNDER_SPACE.code}`);
    expect(rows(await work())).toEqual(['Talepler', 'Görevler', 'Notlar']);
    expect(screen.queryByRole('link', { name: 'Projeler' })).toBeNull();
  });
});

describe('projects: the list', () => {
  it('list: open projects first and closed ones after, each group with its count', async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': listOf(
          project({
            id: 'a2222222-2222-4222-8222-222222222222',
            name: 'Zeytin',
            status: 'planned',
          }),
          project({
            id: 'a3333333-3333-4333-8333-333333333333',
            name: 'Arşiv',
            status: 'completed',
            closed: true,
          }),
          project({ id: 'a4444444-4444-4444-8444-444444444444', name: 'Çınar', status: 'backlog' }),
          project({
            id: 'a5555555-5555-4555-8555-555555555555',
            name: 'Cam',
            status: 'in_progress',
          }),
          project({
            id: 'a6666666-6666-4666-8666-666666666666',
            name: 'Bitmeyen',
            status: 'cancelled',
            closed: true,
          }),
        ),
      }),
    );
    renderApp(LIST);
    const open = await screen.findByRole('region', { name: 'Açık projeler 3' });
    const closed = screen.getByRole('region', { name: 'Kapalı projeler 2' });
    // Open ones stand above the closed ones; inside a group the names are in Turkish order.
    expect(open.compareDocumentPosition(closed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(open)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Cam', 'Çınar', 'Zeytin']);
    expect(
      within(closed)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Arşiv', 'Bitmeyen']);
    // One h1 (the top bar); the groups are h2.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Projeler');
    expect(screen.queryByText('Liste ilk 500 projeyi gösteriyor.')).toBeNull();
  });

  it('list: says that no project is open when only closed ones exist, and that the list is cut', async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': () =>
          json({
            projects: [project({ name: 'Arşiv', status: 'completed', closed: true })],
            truncated: true,
          }),
      }),
    );
    renderApp(LIST);
    const open = await screen.findByRole('region', { name: 'Açık projeler 0' });
    expect(within(open).getByText('Açık proje yok.')).toBeVisible();
    expect(within(open).queryByRole('link')).toBeNull();
    expect(screen.getByRole('region', { name: 'Kapalı projeler 1' })).toBeVisible();
    expect(screen.getByText('Liste ilk 500 projeyi gösteriyor.')).toBeVisible();
  });

  it('list: a row shows the tile, the name, the customer, the members, the AI state, the target date and the status with its word', async () => {
    mockApi(projectHandlers());
    renderApp(LIST);
    const row = (await screen.findByRole('link', { name: /^Depo otomasyonu\./ })).closest('li');
    if (!row) throw new Error('The link is not in a row');
    // The tile leads the row: the project's own colour and icon, hidden from screen readers.
    const tile = row.querySelector('[aria-hidden="true"]');
    expect(tile).toHaveClass('bg-project-teal', 'size-6');
    expect(row.firstElementChild).toContainElement(tile as HTMLElement);
    expect(within(row).getByText('Depo otomasyonu')).toBeVisible();
    // The cells lie under the row's link, where a tooltip of their own never shows (ListRow):
    // the customer's name carries no title that would promise one.
    expect(within(row).getByText('Beta Lojistik')).not.toHaveAttribute('title');
    expect(within(row).getByText('2 üye')).toBeInTheDocument();
    expect(within(row).getByText('Ajanlar çalışamaz')).toBeVisible();
    const date = within(row).getByText(formatDay('2026-11-20'));
    expect(date.tagName).toBe('TIME');
    expect(date).toHaveAttribute('datetime', '2026-11-20');
    // The status is the badge, icon and word together, never an icon alone.
    const badge = within(row).getByText('Sürüyor');
    expect(badge).toHaveClass('bg-status-in-progress-fill');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(row).queryByRole('img')).toBeNull();
    // Nothing in a row is a control.
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it("list: the row's link says the whole row and opens the page", async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': listOf(
          project(),
          project({
            id: 'a2222222-2222-4222-8222-222222222222',
            name: 'İç proje',
            status: 'planned',
            customer: null,
            targetDate: null,
            memberCount: 1,
            aiAllowed: true,
            agentsMayWork: true,
          }),
        ),
      }),
    );
    const { router } = renderApp(LIST);
    const link = await screen.findByRole('link', {
      name: `Depo otomasyonu. Sürüyor. Müşteri: Beta Lojistik. 2 üye. Ajanlar çalışamaz. Hedef tarih: ${formatDay('2026-11-20')}.`,
    });
    // Without a customer and a target date the sentence leaves them out.
    expect(
      screen.getByRole('link', { name: 'İç proje. Planlandı. 1 üye. Ajanlar çalışabilir.' }),
    ).toBeVisible();
    // The whole row is the link: one Tab stop, and the ring is drawn on the row.
    expect(link).toHaveClass('row-link');
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe(PAGE);
  });

  it("list: a row reads Ajanlar çalışabilir only when the project's and its customer's permissions are both open", async () => {
    mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': listOf(
          // The project's own permission is open, its customer's is closed: agents may not work.
          project({ name: 'Yarım', aiAllowed: true, agentsMayWork: false }),
          project({
            id: 'a2222222-2222-4222-8222-222222222222',
            name: 'Tam',
            aiAllowed: true,
            agentsMayWork: true,
          }),
          project({
            id: 'a3333333-3333-4333-8333-333333333333',
            name: 'Kapalı izin',
            aiAllowed: false,
            agentsMayWork: false,
          }),
        ),
      }),
    );
    renderApp(LIST);
    const rowOf = async (name: string) => {
      const row = (await screen.findByRole('link', { name: new RegExp(`^${name}\\.`) })).closest(
        'li',
      );
      if (!row) throw new Error('The link is not in a row');
      return within(row);
    };
    expect((await rowOf('Yarım')).getByText('Ajanlar çalışamaz')).toBeVisible();
    expect((await rowOf('Tam')).getByText('Ajanlar çalışabilir')).toBeVisible();
    expect((await rowOf('Kapalı izin')).getByText('Ajanlar çalışamaz')).toBeVisible();
    // The row never says "Yapay zekâ açık": the page would say the opposite for "Yarım".
    expect(screen.queryByText(/Yapay zekâ (açık|kapalı)/)).toBeNull();
  });

  it("list: the first step when there is no project, in the founder's words and in an employee's", async () => {
    mockApi(projectHandlers(projectDetail(), { 'GET /projects': listOf() }));
    renderApp(LIST);
    expect(await screen.findByRole('heading', { level: 2, name: 'Henüz proje yok' })).toBeVisible();
    expect(
      screen.getByText(
        'İlk projeyi Yeni proje düğmesiyle açın. Bir projeyi ve ona bağlı kayıtları yalnızca üyeleri ve kurucu görür.',
      ),
    ).toBeVisible();
    // One button, the empty state's; the bar's own is not shown beside it. It opens the dialog.
    expect(screen.getAllByRole('button', { name: 'Yeni proje' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: /projeler/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Yeni proje' }));
    expect(await screen.findByRole('dialog', { name: 'Yeni proje' })).toBeVisible();
    cleanup();

    mockApi(
      projectHandlers(projectDetail(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        'GET /projects': listOf(),
      }),
    );
    renderApp(LIST);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Üyesi olduğunuz proje yok' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Yeni proje düğmesiyle bir proje açabilirsiniz; açtığınız projenin üyesi olursunuz. Var olan bir projeye sizi o projenin bir üyesi ya da kurucu ekler.',
      ),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Yeni proje' })).toHaveLength(1);
  });

  it('list: says why and sends nothing for an external person and in Kurucu alanı', async () => {
    const external = mockApi({ 'GET /session': sessionAs(EXTERNAL_AT_ARMADX) });
    renderApp(LIST);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Projeler dış kişilere açık değil' }),
    ).toBeVisible();
    expect(screen.getByText('Projeleri şirketin kurucusu ve çalışanları görür.')).toBeVisible();
    expect(external.callsTo('GET /projects')).toEqual([]);
    expect(external.unexpected).toEqual([]);
    cleanup();

    const space = mockApi({ 'GET /session': sessionHandler() });
    renderApp(`/c/${FOUNDER_SPACE.code}/projects`);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Kurucu alanında proje açılmaz' }),
    ).toBeVisible();
    expect(
      screen.getByText('Projeler şirketlerde tutulur. Şirket menüsünden bir şirket seçin.'),
    ).toBeVisible();
    expect(space.callsTo('GET /projects')).toEqual([]);
    expect(space.unexpected).toEqual([]);
  });

  it('list: loading, then the error with a retry that works', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects': () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      }),
    );
    renderApp(LIST);
    await waitFor(() => {
      expect(api.callsTo('GET /projects')).toHaveLength(1);
    });
    expect(screen.getByText('Yükleniyor')).toBeInTheDocument();
    release(apiError(409, 'invalid_request', 'Liste şu anda okunamadı. Yeniden deneyin.'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Liste şu anda okunamadı. Yeniden deneyin.');
    api.handle('GET /projects', listOf(project()));
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByRole('link', { name: /^Depo otomasyonu\./ })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('list: the customer and the member count are shown only from 1280 px', async () => {
    mockApi(projectHandlers());
    renderApp(LIST);
    await screen.findByRole('link', { name: /^Depo otomasyonu\./ });
    // jsdom applies no stylesheet: the classes are what leaves the two cells out below 1280 px.
    expect(screen.getByText('Beta Lojistik')).toHaveClass('hidden', 'xl:block');
    expect(screen.getByText('2 üye')).toHaveClass('hidden', 'xl:block');
    // What tells two rows apart and what a person must know stays at every width.
    for (const text of ['Ajanlar çalışamaz', formatDay('2026-11-20'), 'Sürüyor']) {
      expect(screen.getByText(text).closest('.hidden')).toBeNull();
    }
  });
});

describe('projects: the page', () => {
  it('page: the top bar reads Projeler and the name, and the page has one h1', async () => {
    mockApi(projectHandlers());
    renderApp(PAGE);
    const bar = await screen.findByRole('banner');
    expect(
      await within(bar).findByRole('heading', { level: 1, name: 'Depo otomasyonu' }),
    ).toBeVisible();
    // Projeler in the top bar is a link to the list.
    expect(within(bar).getByRole('link', { name: 'Projeler' })).toHaveAttribute(
      'href',
      '/c/armadx/projects',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // The name on the page itself is an h2; the sections under it are h3.
    expect(screen.getByRole('heading', { level: 2, name: 'Depo otomasyonu' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Açıklama' })).toBeVisible();
  });

  it('page: the header, the sentence about agents in its three cases, the description or its empty sentence, the sentence of a closed project', async () => {
    const api = mockApi(projectHandlers());
    const first = renderApp(PAGE);
    const name = await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const header = name.closest('header');
    if (!header) throw new Error('The name is not in the header');
    expect(header.querySelector('[aria-hidden="true"]')).toHaveClass('bg-project-teal', 'size-8');
    expect(within(header).getByText('Sürüyor')).toHaveClass('bg-status-in-progress-fill');
    // The project's own permission is closed.
    const said = () =>
      screen
        .getAllByRole('status')
        .map((region) => region.textContent)
        .filter((text) => text.startsWith('Bu projede'));
    expect(said()).toEqual(['Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.']);
    const description = screen.getByText(/Depo süreçlerinin çıkarılması\./);
    expect(description).toHaveTextContent('İkinci satır.');
    expect(description).toHaveClass('whitespace-pre-wrap');
    expect(description).toHaveAttribute('dir', 'auto');
    expect(screen.queryByText(/Bu proje kapalı/)).toBeNull();

    // The project's permission is open, its customer's contract forbids it.
    api.handle(`GET /projects/${PROJECT_ID}`, () =>
      json(projectDetail({ aiAllowed: true, agentsMayWork: false, description: null })),
    );
    await first.queryClient.invalidateQueries();
    await waitFor(() => {
      expect(said()).toEqual([
        'Bu projede ajanlar çalışamaz: müşterinin sözleşmesi yapay zekâ kullanımına izin vermiyor.',
      ]);
    });
    expect(screen.getByText('Açıklama yazılmamış.')).toBeVisible();

    // Both are open; and the project is closed.
    api.handle(`GET /projects/${PROJECT_ID}`, () =>
      json(
        projectDetail({
          aiAllowed: true,
          agentsMayWork: true,
          status: 'cancelled',
          closed: true,
          customer: {
            id: CUSTOMER_ID,
            name: 'Beta Lojistik',
            aiAllowed: true,
            automatedProcessingAllowed: false,
          },
        }),
      ),
    );
    await first.queryClient.invalidateQueries();
    await waitFor(() => {
      expect(said()).toEqual(['Bu projede ajanlar çalışabilir.']);
    });
    expect(
      screen.getByText(
        'Bu proje kapalı. Yeniden açmak için Projeyi düzenle ile durumunu Beklemede, Planlandı ya da Sürüyor yapın.',
      ),
    ).toBeVisible();
    expect(within(header).getByText('İptal')).toHaveClass('bg-status-cancelled-fill');
  });

  it('page: the properties name status, customer, target date, colour and icon, members, opener and time', async () => {
    stubMatchMedia([WIDE_WINDOW_QUERY]);
    const api = mockApi(projectHandlers());
    const { queryClient } = renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf(panel(), 'Durum')).toHaveTextContent('Sürüyor');
    expect(valueOf(panel(), 'Müşteri')).toHaveTextContent('Beta Lojistik');
    const date = within(valueOf(panel(), 'Hedef tarih')).getByText(formatDay('2026-11-20'));
    expect(date).toHaveAttribute('datetime', '2026-11-20');
    const look = valueOf(panel(), 'Renk ve simge');
    expect(look).toHaveTextContent('Turkuaz, Kutu');
    expect(look.querySelector('[aria-hidden="true"]')).toHaveClass('bg-project-teal');
    expect(valueOf(panel(), 'Üyeler')).toHaveTextContent('2 kişi');
    expect(valueOf(panel(), 'Oluşturan')).toHaveTextContent('Ömer Kadıoğlu');
    const created = within(valueOf(panel(), 'Oluşturulma')).getByText(
      formatFull('2026-10-08T09:00:00.000Z'),
    );
    expect(created).toHaveAttribute('datetime', '2026-10-08T09:00:00.000Z');
    // The two sections of the panel are h3 under the panel's own h2.
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Özellikler' })).toBeVisible();
    const ai = within(panel()).getByRole('region', { name: 'Yapay zekâ izni' });
    // "İzin kapalı", never "Kapalı" alone: the project itself is open or closed on this screen.
    expect(within(ai).getByText('İzin kapalı')).toBeVisible();
    expect(within(ai).queryByText('Kapalı')).toBeNull();
    expect(
      within(ai).getByText('Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.'),
    ).toBeVisible();
    const contract = within(panel()).getByRole('region', { name: 'Müşterinin sözleşmesi' });
    expect(valueOf(contract, 'Yapay zekâ kullanımı')).toHaveTextContent('İzin yok');
    expect(valueOf(contract, 'Kodla otomatik işleme')).toHaveTextContent('İzin yok');

    // What is not known says so in words; a project without a customer has no contract section.
    api.handle(`GET /projects/${PROJECT_ID}`, () =>
      json(
        projectDetail({
          customer: null,
          targetDate: null,
          createdBy: null,
          aiAllowed: true,
          agentsMayWork: true,
        }),
      ),
    );
    await queryClient.invalidateQueries();
    await waitFor(() => {
      expect(valueOf(panel(), 'Müşteri')).toHaveTextContent('Müşteri yok');
    });
    expect(valueOf(panel(), 'Hedef tarih')).toHaveTextContent('Belirlenmedi');
    expect(valueOf(panel(), 'Oluşturan')).toHaveTextContent('Bilinmiyor');
    expect(within(panel()).getByRole('region', { name: 'Yapay zekâ izni' })).toHaveTextContent(
      'İzin açık',
    );
    expect(within(panel()).queryByRole('region', { name: 'Müşterinin sözleşmesi' })).toBeNull();

    // An opener who is no member of the company any more.
    api.handle(`GET /projects/${PROJECT_ID}`, () =>
      json(projectDetail({ createdBy: { userId: AYSE.userId, name: null } })),
    );
    await queryClient.invalidateQueries();
    await waitFor(() => {
      expect(valueOf(panel(), 'Oluşturan')).toHaveTextContent('Eski üye');
    });
  });

  it('page: the properties name the owner, or Yok', async () => {
    stubMatchMedia([WIDE_WINDOW_QUERY]);
    // The opener and the owner are two rows: the ownership was handed over to Ayşe.
    const api = mockApi(
      projectHandlers(
        projectDetail({
          members: [
            { ...FOUNDER_MEMBER, projectRole: 'member', removable: true },
            { ...AYSE, projectRole: 'owner', removable: false, roleChanges: [] },
          ],
        }),
      ),
    );
    const { queryClient } = renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf(panel(), 'Oluşturan')).toHaveTextContent('Ömer Kadıoğlu');
    expect(valueOf(panel(), 'Sahip')).toHaveTextContent('Ayşe Yılmaz');
    // The owner's row comes right after the opener's.
    expect(valueOf(panel(), 'Oluşturan').nextElementSibling).toHaveTextContent('Sahip');

    // An owner whose name could not be read.
    api.handle(`GET /projects/${PROJECT_ID}`, () =>
      json(
        projectDetail({
          members: [
            { ...AYSE, name: null, projectRole: 'owner', removable: false, roleChanges: [] },
          ],
        }),
      ),
    );
    await queryClient.invalidateQueries();
    await waitFor(() => {
      expect(valueOf(panel(), 'Sahip')).toHaveTextContent('Eski üye');
    });

    // A project without an owner says so in a word.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail({ members: [AYSE] })));
    await queryClient.invalidateQueries();
    await waitFor(() => {
      expect(valueOf(panel(), 'Sahip')).toHaveTextContent('Yok');
    });
  });

  it('page: Proje bulunamadı for a 404 and for an id that is not a UUID, with the way back', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [`GET /projects/${PROJECT_ID}`]: () => apiError(404, 'not_found', 'Kayıt bulunamadı.'),
      }),
    );
    const first = renderApp(PAGE);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Proje bulunamadı' }),
    ).toBeVisible();
    expect(screen.getByText('Bu proje yok ya da size açık değil.')).toBeVisible();
    // Hidden and missing are one answer: it is not asked again.
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
    // The top bar names the kind of page, not a project.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Proje');
    await userEvent.click(screen.getByRole('link', { name: 'Projelere dön' }));
    expect(await screen.findByRole('region', { name: 'Açık projeler 1' })).toBeVisible();
    expect(currentLocation(first.router).pathname).toBe(LIST);

    // An id that is not a UUID is not sent to the API at all.
    await first.router.navigate({ to: '/c/armadx/projects/not-an-id' as never });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Proje bulunamadı' }),
    ).toBeVisible();
    expect(api.callsTo('GET /projects/not-an-id')).toEqual([]);
  });

  it('page: an employee who is not a member gets Proje bulunamadı, the same screen as for a project that does not exist', async () => {
    // The API answers a project the reader may not see exactly like one that does not exist.
    const api = mockApi({
      'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      [`GET /projects/${PROJECT_ID}`]: () => apiError(404, 'not_found', 'Kayıt bulunamadı.'),
    });
    renderApp(PAGE);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Proje bulunamadı' }),
    ).toBeVisible();
    expect(screen.getByText('Bu proje yok ya da size açık değil.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Projelere dön' })).toBeVisible();
    // Nothing of the project is on the screen, and nothing else was asked for it.
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('page: the panel shows beside the page from 1280 px and behind its toggle below', async () => {
    const media = stubMatchMedia([WIDE_WINDOW_QUERY]);
    mockApi(projectHandlers());
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    // Wide: the panel is there without being asked for, and has no toggle.
    expect(panel()).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();

    // Narrower: the panel follows the person's own choice, which starts closed.
    media.set(WIDE_WINDOW_QUERY, false);
    const show = await screen.findByRole('button', { name: 'Özellikleri göster' });
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    // The body alone still says the status and whether agents may work.
    expect(screen.getByText('Sürüyor', { selector: 'header span' })).toBeVisible();
    expect(
      screen.getByText('Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible();
    await userEvent.click(show);
    expect(panel()).toBeVisible();
    expect(screen.getByRole('button', { name: 'Özellikleri gizle' })).toBeVisible();
  });

  it('page: says why and sends nothing for an external person and in Kurucu alanı', async () => {
    const external = mockApi({ 'GET /session': sessionAs(EXTERNAL_AT_ARMADX) });
    renderApp(PAGE);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Projeler dış kişilere açık değil' }),
    ).toBeVisible();
    expect(external.callsTo(`GET /projects/${PROJECT_ID}`)).toEqual([]);
    expect(external.unexpected).toEqual([]);
    cleanup();

    const space = mockApi({ 'GET /session': sessionHandler() });
    renderApp(`/c/${FOUNDER_SPACE.code}/projects/${PROJECT_ID}`);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Kurucu alanında proje açılmaz' }),
    ).toBeVisible();
    expect(space.callsTo(`GET /projects/${PROJECT_ID}`)).toEqual([]);
    expect(space.unexpected).toEqual([]);
  });
});

describe('projects: members', () => {
  const DENIZ = { userId: '66666666-6666-4666-8666-666666666666', name: 'Deniz Öz' };
  // The signed-in person as an employee who is a member (the session's user id is the same).
  const ME = { ...FOUNDER_MEMBER, role: 'employee' as const };
  const row = (name: string) => screen.getByRole('group', { name });

  it("members: names, roles and the reader's own row; adds a person and says so", async () => {
    const before = projectDetail({
      members: [
        FOUNDER_MEMBER,
        // A deactivated account is given no role.
        { ...AYSE, active: false, roleChanges: [] },
        {
          userId: '55555555-5555-4555-8555-555555555555',
          name: null,
          role: null,
          active: false,
          projectRole: 'member',
          removable: true,
          roleChanges: [],
        },
      ],
    });
    const api = mockApi(
      projectHandlers(before, {
        'GET /projects/member-candidates': () =>
          json({ people: [...CANDIDATES, { ...DENIZ, role: 'founder' }] }),
        [`PUT /projects/${PROJECT_ID}/members/${CAGAN.userId}`]: () =>
          json(projectDetail({ members: [...before.members, CAGAN] })),
      }),
    );
    renderApp(PAGE);
    const section = await screen.findByRole('region', { name: 'Üyeler 3' });
    // By name in Turkish order; a person whose name could not be read comes last.
    expect(
      within(section)
        .getAllByRole('group')
        .map((group) => group.firstElementChild?.textContent),
    ).toEqual([
      'Ayşe YılmazÜye, Çalışan, devre dışı',
      'Ömer Kadıoğlu (siz)Sahip, Kurucu',
      'Eski üyeÜye, devre dışı',
    ]);

    const select = await within(section).findByRole('combobox', { name: 'Eklenecek kişi' });
    await waitFor(() => {
      expect(within(select).getAllByRole('option')).toHaveLength(3);
    });
    // Only the people who are not members yet; a founder is marked.
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Kişi seçin', 'Çağan Ünal', 'Deniz Öz, kurucu']);
    await userEvent.selectOptions(select, CAGAN.userId);
    const add = within(section).getByRole('button', { name: 'Üye ekle' });
    await userEvent.click(add);
    expect(await screen.findByText('Çağan Ünal projeye eklendi.')).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Üyeler 4' })).toBeVisible();
    // A new member is always a plain member.
    expect(within(row('Çağan Ünal')).getByText('Üye, Çalışan')).toBeVisible();
    // The request names the project and the person, and carries nothing else: no passkey.
    const [call] = api.callsTo(`PUT /projects/${PROJECT_ID}/members/${CAGAN.userId}`);
    expect(call?.body).toBeUndefined();
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    // Ready for the next person: the select is back at its first option, the focus on the button.
    expect(select).toHaveValue('');
    expect(add).toHaveFocus();
    expect(api.unexpected).toEqual([]);
  });

  it('members: removes after a plain confirmation; no passkey is asked; the focus goes to the heading', async () => {
    const remove = `DELETE /projects/${PROJECT_ID}/members/${AYSE.userId}`;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [remove]: () => apiError(404, 'not_found', 'Bu kişi artık projenin üyesi değil.'),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('region', { name: 'Üyeler 2' });
    const button = within(row('Ayşe Yılmaz')).getByRole('button', { name: 'Projeden çıkar' });
    await userEvent.click(button);
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Yılmaz projeden çıkarılsın mı?',
    });
    expect(dialog).toHaveTextContent(
      'Bu projeyi ve projeye bağlı kayıtları artık göremez. Gerekirse yeniden ekleyebilirsiniz.',
    );
    // The safe button has the focus; giving up sends nothing and returns the focus.
    const cancel = within(dialog).getByRole('button', { name: 'Vazgeç' });
    expect(cancel).toHaveFocus();
    await userEvent.click(cancel);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(remove)).toEqual([]);
    await waitFor(() => {
      expect(button).toHaveFocus();
    });

    // A refusal is read in the dialog, which stays.
    await userEvent.click(button);
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Projeden çıkar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bu kişi artık projenin üyesi değil.',
    );
    expect(screen.getByRole('alertdialog')).toBeVisible();

    api.handle(remove, () => json(projectDetail({ members: [FOUNDER_MEMBER] })));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Projeden çıkar' }));
    expect(await screen.findByText('Ayşe Yılmaz projeden çıkarıldı.')).toBeVisible();
    const section = await screen.findByRole('region', { name: 'Üyeler 1' });
    expect(screen.queryByRole('group', { name: 'Ayşe Yılmaz' })).toBeNull();
    expect(api.callsTo(remove)).toHaveLength(2);
    expect(api.callsTo(remove)[1]?.body).toBeUndefined();
    // No passkey (5 October decision 4).
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    // The row took its button with it; the keyboard stays in the section.
    await waitFor(() => {
      expect(within(section).getByRole('heading', { level: 3 })).toHaveFocus();
    });
  });

  it("members: the remove button follows the API's answer: an employee has none on their own row and nobody has one on the owner's; the founder who is a plain member has one", async () => {
    const none = { removable: false, roleChanges: [] };
    // The reader is a manager of the project: a plain member's row has the button, their own and
    // the owner's have none (8 October decision 44).
    mockApi(
      projectHandlers(
        projectForEmployee({
          members: [
            { ...ME, projectRole: 'manager', ...none },
            { ...AYSE, projectRole: 'owner', ...none },
            { ...CAGAN, roleChanges: [] },
          ],
        }),
        { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) },
      ),
    );
    renderApp(PAGE);
    let section = await screen.findByRole('region', { name: 'Üyeler 3' });
    expect(within(row('Ömer Kadıoğlu (siz)')).queryByRole('button')).toBeNull();
    expect(within(row('Ayşe Yılmaz')).queryByRole('button')).toBeNull();
    expect(within(row('Çağan Ünal')).getByRole('button', { name: 'Projeden çıkar' })).toBeVisible();
    expect(within(section).getAllByRole('button', { name: 'Projeden çıkar' })).toHaveLength(1);
    cleanup();

    // A plain member manages nobody: no button on any row and no form to add a person.
    const forMember = projectForEmployee({
      members: [
        { ...ME, projectRole: 'member', ...none },
        { ...AYSE, projectRole: 'owner', ...none },
        { ...CAGAN, ...none },
      ],
    });
    mockApi(
      projectHandlers(
        { ...forMember, actions: { ...forMember.actions, addMembers: false } },
        { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) },
      ),
    );
    renderApp(PAGE);
    section = await screen.findByRole('region', { name: 'Üyeler 3' });
    expect(within(section).queryByRole('button')).toBeNull();
    expect(within(section).queryByRole('combobox', { name: 'Eklenecek kişi' })).toBeNull();
    cleanup();

    // The founder who owns the project has no button on their own row either: the owner is not
    // removed.
    mockApi(projectHandlers());
    renderApp(PAGE);
    await screen.findByRole('region', { name: 'Üyeler 2' });
    expect(within(row('Ömer Kadıoğlu (siz)')).queryByRole('button')).toBeNull();
    expect(
      within(row('Ayşe Yılmaz')).getByRole('button', { name: 'Projeden çıkar' }),
    ).toBeVisible();
    cleanup();

    // The founder who is a plain member may take themselves off: they see every project anyway,
    // and the dialog says so.
    mockApi(
      projectHandlers(
        projectDetail({
          members: [
            {
              ...FOUNDER_MEMBER,
              projectRole: 'member',
              removable: true,
              roleChanges: ['manager', 'owner'],
            },
            { ...AYSE, projectRole: 'owner', ...none },
          ],
        }),
      ),
    );
    renderApp(PAGE);
    await screen.findByRole('region', { name: 'Üyeler 2' });
    expect(within(row('Ayşe Yılmaz')).queryByRole('button')).toBeNull();
    await userEvent.click(
      within(row('Ömer Kadıoğlu (siz)')).getByRole('button', { name: 'Projeden çıkar' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Ömer Kadıoğlu projeden çıkarılsın mı?',
    });
    expect(dialog).toHaveTextContent('Kurucu, üye olmasa da bütün projeleri görür.');
    expect(dialog).not.toHaveTextContent('artık göremez');
  });

  it('members: says so when everybody is a member already', async () => {
    const full = projectDetail({ members: [FOUNDER_MEMBER, AYSE, CAGAN] });
    const api = mockApi(
      projectHandlers(projectDetail({ members: [FOUNDER_MEMBER, AYSE] }), {
        [`PUT /projects/${PROJECT_ID}/members/${CAGAN.userId}`]: () => json(full),
      }),
    );
    renderApp(PAGE);
    const section = await screen.findByRole('region', { name: 'Üyeler 2' });
    const select = await within(section).findByRole('combobox', { name: 'Eklenecek kişi' });
    await waitFor(() => {
      expect(within(select).getAllByRole('option')).toHaveLength(2);
    });
    await userEvent.selectOptions(select, CAGAN.userId);
    await userEvent.click(within(section).getByRole('button', { name: 'Üye ekle' }));
    expect(
      await screen.findByText('Şirketteki bütün kurucu ve çalışanlar bu projenin üyesi.'),
    ).toBeVisible();
    // The controls went away with the last person: the focus is on the heading, not lost.
    expect(screen.queryByRole('combobox', { name: 'Eklenecek kişi' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Üye ekle' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Üyeler 3' })).getByRole('heading', { level: 3 }),
    ).toHaveFocus();
    expect(api.unexpected).toEqual([]);
  });

  it('members: the button reads Üye ekle and says to choose a person when none is chosen; a people list that fails offers Yeniden dene', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'GET /projects/member-candidates': () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      }),
    );
    renderApp(PAGE);
    const section = await screen.findByRole('region', { name: 'Üyeler 2' });
    // While the people are read the select says so and nothing can be chosen.
    const select = within(section).getByRole('combobox', { name: 'Eklenecek kişi' });
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Kişiler yükleniyor']);
    await waitFor(() => {
      expect(api.callsTo('GET /projects/member-candidates')).toHaveLength(1);
    });
    release(apiError(409, 'invalid_request', 'Okunamadı.'));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Kişi listesi alınamadı.');
    expect(within(section).queryByRole('combobox')).toBeNull();

    api.handle('GET /projects/member-candidates', () => json({ people: CANDIDATES }));
    await userEvent.click(within(section).getByRole('button', { name: 'Yeniden dene' }));
    const ready = await within(section).findByRole('combobox', { name: 'Eklenecek kişi' });
    expect(ready).not.toHaveAttribute('aria-disabled');

    // The button says what it does when it is heard alone, and stays reachable without a choice.
    const add = within(section).getByRole('button', { name: 'Üye ekle' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).not.toBeDisabled();
    await userEvent.click(add);
    const problem = within(section).getByRole('alert');
    expect(problem).toHaveTextContent('Önce bir kişi seçin.');
    expect(ready).toHaveAttribute('aria-invalid', 'true');
    expect(ready).toHaveAttribute('aria-describedby', problem.id);
    expect(api.calls.filter((call) => call.method === 'PUT')).toEqual([]);
    // Choosing a person takes the sentence away.
    await userEvent.selectOptions(ready, CAGAN.userId);
    expect(within(section).queryByRole('alert')).toBeNull();
    expect(add).not.toHaveAttribute('aria-disabled');
  });

  it('members: a refused person is said in a message and the people are read again', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [`PUT /projects/${PROJECT_ID}/members/${CAGAN.userId}`]: () =>
          apiError(
            409,
            'member_not_allowed',
            'Seçilen kişi projeye üye olamaz: projeye yalnızca şirketin kurucusu ve çalışanları üye olur. Kişiyi listeden yeniden seçin.',
          ),
      }),
    );
    renderApp(PAGE);
    const section = await screen.findByRole('region', { name: 'Üyeler 2' });
    const select = await within(section).findByRole('combobox', { name: 'Eklenecek kişi' });
    await waitFor(() => {
      expect(within(select).getAllByRole('option')).toHaveLength(2);
    });
    // The person became an external person meanwhile: the list the choice came from is stale.
    api.handle('GET /projects/member-candidates', () =>
      json({ people: CANDIDATES.filter((person) => person.userId !== CAGAN.userId) }),
    );
    await userEvent.selectOptions(select, CAGAN.userId);
    await userEvent.click(within(section).getByRole('button', { name: 'Üye ekle' }));
    expect(await screen.findByText(/Seçilen kişi projeye üye olamaz/)).toBeVisible();
    // Nothing is shown as added, and the stale list was read again by the panel itself.
    expect(screen.getByRole('region', { name: 'Üyeler 2' })).toBeVisible();
    await waitFor(() => {
      expect(api.callsTo('GET /projects/member-candidates')).toHaveLength(2);
    });
    expect(
      await screen.findByText('Şirketteki bütün kurucu ve çalışanlar bu projenin üyesi.'),
    ).toBeVisible();
  });

  // Roles (8 October decision 44). The people of these tests, before a reader is chosen; the
  // flags of every member are computed with the shared rule the API uses (membersFor).
  const person = (
    who: { userId: string; name: string | null },
    projectRole: MemberOfProject['projectRole'],
    more: Partial<Pick<MemberOfProject, 'role' | 'active'>> = {},
  ): MemberOfProject => ({
    userId: who.userId,
    name: who.name,
    role: 'employee',
    active: true,
    projectRole,
    ...more,
  });
  const EMRE = { userId: '77777777-7777-4777-8777-777777777777', name: 'Emre Su' };
  const MINE = 'Ömer Kadıoğlu (siz)';
  const OWNER_WORDS =
    'Projenin sahibi bu kişi olur. Siz üye olarak kalırsınız; üye ekleyip çıkaramaz, rol veremezsiniz. Sahipliği size yeni sahip ya da kurucu geri verebilir.';

  /** Opens the project page for a reader, with the role route answering as the API does. */
  function openAs(
    reader: 'founder' | 'employee',
    people: readonly MemberOfProject[],
    extra: Record<string, Handler> = {},
  ) {
    const founder = reader === 'founder';
    const api = mockApi(
      projectHandlers(projectWithRoles(founder, people), {
        ...(founder ? {} : { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
        ...roleHandlers(founder, people),
        ...extra,
      }),
    );
    renderApp(PAGE);
    return api;
  }
  const section = (count: number) =>
    screen.findByRole('region', { name: `Üyeler ${String(count)}` });
  const roleButton = (name: string) =>
    within(row(name)).getByRole('button', { name: 'Rolü değiştir' });
  async function openRoleMenu(name: string) {
    await userEvent.click(roleButton(name));
    return screen.findByRole('menu');
  }
  const itemsOf = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
  const lineOf = (name: string) => row(name).firstElementChild?.lastElementChild?.textContent;
  const roleCalls = (api: ReturnType<typeof mockApi>) =>
    api.calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/role'));

  it('members: every row names the project role and the company role', async () => {
    openAs('founder', [
      person(FOUNDER_MEMBER, 'owner', { role: 'founder' }),
      person(AYSE, 'manager'),
      person(CAGAN, 'member', { active: false }),
      person(DENIZ, 'manager', { role: 'founder' }),
      person({ userId: '55555555-5555-4555-8555-555555555555', name: null }, 'member', {
        role: null,
        active: false,
      }),
    ]);
    await section(5);
    expect(lineOf('Ayşe Yılmaz')).toBe('Yönetici, Çalışan');
    expect(lineOf('Çağan Ünal')).toBe('Üye, Çalışan, devre dışı');
    expect(lineOf('Deniz Öz')).toBe('Yönetici, Kurucu');
    expect(lineOf(MINE)).toBe('Sahip, Kurucu');
    expect(lineOf('Eski üye')).toBe('Üye, devre dışı');
  });

  it('members: a plain member sees no button, no role control and no add form, and reads who manages members', async () => {
    const api = openAs('employee', [
      person(FOUNDER_MEMBER, 'member'),
      person(AYSE, 'owner'),
      person(CAGAN, 'manager'),
      person(DENIZ, 'member'),
    ]);
    const members = await section(4);
    expect(within(members).queryByRole('button')).toBeNull();
    expect(within(members).queryByRole('combobox')).toBeNull();
    expect(
      within(members).getByText(
        'Üye eklemeyi ve çıkarmayı projenin sahibi, yöneticileri ve kurucu yapar.',
      ),
    ).toBeVisible();
    // The roles are still read, as words.
    expect(lineOf('Ayşe Yılmaz')).toBe('Sahip, Çalışan');
    expect(lineOf(MINE)).toBe('Üye, Çalışan');
    // Nobody to choose from was asked for: there is no form to choose in.
    expect(api.callsTo('GET /projects/member-candidates')).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });

  it("members: a manager adds and removes plain members and has no role control; a manager's and the owner's rows have no button", async () => {
    const people = [
      person(FOUNDER_MEMBER, 'manager'),
      person(AYSE, 'owner'),
      person(CAGAN, 'member'),
      person(DENIZ, 'manager'),
    ];
    const remove = `DELETE /projects/${PROJECT_ID}/members/${CAGAN.userId}`;
    const add = `PUT /projects/${PROJECT_ID}/members/${EMRE.userId}`;
    const api = openAs('employee', people, {
      'GET /projects/member-candidates': () =>
        json({ people: [...CANDIDATES, { ...EMRE, role: 'employee' }] }),
      [add]: () => json(projectWithRoles(false, [...people, person(EMRE, 'member')])),
      [remove]: () =>
        json(
          projectWithRoles(
            false,
            people.filter((member) => member.userId !== CAGAN.userId),
          ),
        ),
    });
    const members = await section(4);
    expect(within(members).queryByRole('button', { name: 'Rolü değiştir' })).toBeNull();
    expect(within(row(MINE)).queryByRole('button')).toBeNull();
    expect(within(row('Ayşe Yılmaz')).queryByRole('button')).toBeNull();
    expect(within(row('Deniz Öz')).queryByRole('button')).toBeNull();
    expect(
      within(row('Çağan Ünal'))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Projeden çıkar']);

    // Adds: the new member is a plain member, whom a manager can take off again.
    const select = await within(members).findByRole('combobox', { name: 'Eklenecek kişi' });
    await waitFor(() => {
      expect(within(select).getAllByRole('option')).toHaveLength(2);
    });
    await userEvent.selectOptions(select, EMRE.userId);
    await userEvent.click(within(members).getByRole('button', { name: 'Üye ekle' }));
    expect(await screen.findByText('Emre Su projeye eklendi.')).toBeVisible();
    expect(lineOf('Emre Su')).toBe('Üye, Çalışan');
    expect(within(row('Emre Su')).getByRole('button', { name: 'Projeden çıkar' })).toBeVisible();

    // Removes a plain member.
    await userEvent.click(
      within(row('Çağan Ünal')).getByRole('button', { name: 'Projeden çıkar' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Çağan Ünal projeden çıkarılsın mı?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Projeden çıkar' }));
    expect(await screen.findByText('Çağan Ünal projeden çıkarıldı.')).toBeVisible();
    expect(api.callsTo(remove)).toHaveLength(1);
    expect(roleCalls(api)).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });

  it("members: the owner makes a member a manager and takes it back through the row's menu; the line under the name changes only when the API has stored it; the toast says what happened", async () => {
    const people = [
      person(FOUNDER_MEMBER, 'owner'),
      person(AYSE, 'member'),
      person(CAGAN, 'manager'),
      person(DENIZ, 'manager', { active: false }),
      person(EMRE, 'member', { active: false }),
    ];
    const answer = roleHandlers(false, people)[roleRoute(AYSE.userId)];
    if (!answer) throw new Error('No role route for the member');
    let release: () => void = () => undefined;
    let held = true;
    const api = openAs('employee', people, {
      // The first answer waits until the test lets it go.
      [roleRoute(AYSE.userId)]: async (call) => {
        if (held) {
          held = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return answer(call);
      },
    });
    await section(5);

    // What each row offers: the acts the API allows, never the role the member already has.
    expect(itemsOf(await openRoleMenu('Çağan Ünal'))).toEqual([
      'Yöneticilikten al',
      'Sahipliği devret',
    ]);
    await userEvent.keyboard('{Escape}');
    // A deactivated manager can only be dismissed; a deactivated plain member is given no role.
    expect(itemsOf(await openRoleMenu('Deniz Öz'))).toEqual(['Yöneticilikten al']);
    await userEvent.keyboard('{Escape}');
    expect(within(row('Emre Su')).queryByRole('button', { name: 'Rolü değiştir' })).toBeNull();
    // The owner's own row has no control at all.
    expect(within(row(MINE)).queryByRole('button')).toBeNull();

    const menu = await openRoleMenu('Ayşe Yılmaz');
    expect(itemsOf(menu)).toEqual(['Yönetici yap', 'Sahipliği devret']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Yönetici yap' }));
    await waitFor(() => {
      expect(api.callsTo(roleRoute(AYSE.userId))).toHaveLength(1);
    });
    // On its way: nothing is shown as changed, and the menu opens nothing.
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');
    const trigger = roleButton('Ayşe Yılmaz');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByText('Ayşe Yılmaz yönetici yapıldı.')).toBeNull();

    release();
    expect(await screen.findByText('Ayşe Yılmaz yönetici yapıldı.')).toBeVisible();
    expect(lineOf('Ayşe Yılmaz')).toBe('Yönetici, Çalışan');
    expect(api.callsTo(roleRoute(AYSE.userId))[0]?.body).toEqual({ role: 'manager' });
    // The row stays, and so does the keyboard: the focus is on its menu button.
    expect(roleButton('Ayşe Yılmaz')).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute('aria-disabled');

    // One more choice takes it back.
    const again = await openRoleMenu('Ayşe Yılmaz');
    expect(itemsOf(again)).toEqual(['Yöneticilikten al', 'Sahipliği devret']);
    await userEvent.click(within(again).getByRole('menuitem', { name: 'Yöneticilikten al' }));
    expect(await screen.findByText('Ayşe Yılmaz artık yönetici değil.')).toBeVisible();
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');
    expect(api.callsTo(roleRoute(AYSE.userId))[1]?.body).toEqual({ role: 'member' });
    // No confirmation and no passkey for either (5 October decision 4).
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });

  it("members: Sahipliği devret asks first; Vazgeç changes nothing and returns the focus to the row's Rolü değiştir; the confirm button sends the role, and the owner then sees the page of a plain member", async () => {
    const api = openAs('employee', [
      person(FOUNDER_MEMBER, 'owner'),
      person(AYSE, 'member'),
      person(CAGAN, 'manager'),
    ]);
    const members = await section(3);
    const menuButton = roleButton('Ayşe Yılmaz');
    const menu = await openRoleMenu('Ayşe Yılmaz');
    // From here on the menu button must not get the focus until the confirmation is given up.
    const pulledBack = vi.fn();
    menuButton.addEventListener('focus', pulledBack);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sahipliği devret' }));
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Sahiplik Ayşe Yılmaz adlı üyeye devredilsin mi?',
    });
    expect(dialog).toHaveAccessibleDescription(OWNER_WORDS);
    // Nothing was sent by choosing the item, and the safe button has the focus.
    expect(roleCalls(api)).toEqual([]);
    const cancel = within(dialog).getByRole('button', { name: 'Vazgeç' });
    await waitFor(() => {
      expect(cancel).toHaveFocus();
    });
    // The closing menu did not take the focus to its button on the way: a screen reader hears the
    // confirmation, not the button and then the confirmation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pulledBack).not.toHaveBeenCalled();
    expect(cancel).toHaveFocus();
    menuButton.removeEventListener('focus', pulledBack);
    await userEvent.click(cancel);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(roleCalls(api)).toEqual([]);
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');
    await waitFor(() => {
      expect(roleButton('Ayşe Yılmaz')).toHaveFocus();
    });

    // Escape gives up too.
    await userEvent.click(
      within(await openRoleMenu('Ayşe Yılmaz')).getByRole('menuitem', { name: 'Sahipliği devret' }),
    );
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(roleCalls(api)).toEqual([]);
    await waitFor(() => {
      expect(roleButton('Ayşe Yılmaz')).toHaveFocus();
    });

    await userEvent.click(
      within(await openRoleMenu('Ayşe Yılmaz')).getByRole('menuitem', { name: 'Sahipliği devret' }),
    );
    dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Sahipliği devret' });
    // Not the red button of a removal: nothing is lost that cannot be given back.
    expect(confirm).toHaveAttribute('data-variant', 'default');
    await userEvent.click(confirm);
    expect(await screen.findByText('Projenin yeni sahibi: Ayşe Yılmaz.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(roleRoute(AYSE.userId))).toHaveLength(1);
    expect(api.callsTo(roleRoute(AYSE.userId))[0]?.body).toEqual({ role: 'owner' });
    expect(api.callsTo('POST /step-up/options')).toEqual([]);

    // The page of a plain member: the roles as stored, no control, and who manages members.
    expect(lineOf('Ayşe Yılmaz')).toBe('Sahip, Çalışan');
    expect(lineOf(MINE)).toBe('Üye, Çalışan');
    expect(lineOf('Çağan Ünal')).toBe('Yönetici, Çalışan');
    expect(within(members).queryByRole('button')).toBeNull();
    expect(within(members).queryByRole('combobox')).toBeNull();
    expect(within(members).getByText(MEMBERS_TEXT.whoManages)).toBeVisible();
    expect(within(members).queryByText(MEMBERS_TEXT.handOverHint)).toBeNull();
    // The reader's controls went away: the keyboard stays in the section.
    await waitFor(() => {
      expect(within(members).getByRole('heading', { level: 3 })).toHaveFocus();
    });
    expect(api.unexpected).toEqual([]);
  });

  it('members: the menu by keyboard: Enter opens it, the arrows move without choosing anything, Escape closes it and no request was sent', async () => {
    const api = openAs('employee', [person(FOUNDER_MEMBER, 'owner'), person(AYSE, 'member')]);
    await section(2);
    const trigger = roleButton('Ayşe Yılmaz');
    // A menu button, named after its row's person by the group around it.
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(row('Ayşe Yılmaz')).toContainElement(trigger);
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    const manager = within(menu).getByRole('menuitem', { name: 'Yönetici yap' });
    const handOver = within(menu).getByRole('menuitem', { name: 'Sahipliği devret' });
    await waitFor(() => {
      expect(manager).toHaveFocus();
    });
    // Moving gives nothing: a select would have made the person a manager on the way.
    await userEvent.keyboard('{ArrowDown}');
    expect(handOver).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(manager).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(handOver).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(roleCalls(api)).toEqual([]);
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');

    // Only Enter on an item gives the role.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(
        within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Yönetici yap' }),
      ).toHaveFocus();
    });
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Ayşe Yılmaz yönetici yapıldı.')).toBeVisible();
    expect(roleCalls(api).map((call) => call.body)).toEqual([{ role: 'manager' }]);
  });

  it('members: the hint under the list: the hand-over for the owner and the founder, who removes managers for a manager, none for a plain member', async () => {
    const HAND_OVER =
      'Sahip projeden çıkarılamaz. Sahipliği devretmek için bir üyenin "Rolü değiştir" menüsünü kullanın.';
    const MANAGER =
      'Bir yöneticiyi projeden yalnızca sahip ya da kurucu çıkarır; rolleri de onlar verir.';
    const hints = (members: HTMLElement) => [
      within(members).queryByText(HAND_OVER) !== null,
      within(members).queryByText(MANAGER) !== null,
    ];

    // The owner.
    openAs('employee', [person(FOUNDER_MEMBER, 'owner'), person(AYSE, 'manager')]);
    let members = await section(2);
    expect(hints(members)).toEqual([true, false]);
    // Under the list, before the form to add a person.
    const hint = within(members).getByText(HAND_OVER);
    expect(within(members).getByRole('list').nextElementSibling).toBe(hint);
    cleanup();

    // The founder, member of the project or not.
    openAs('founder', [person(AYSE, 'owner'), person(CAGAN, 'member')]);
    members = await section(2);
    expect(hints(members)).toEqual([true, false]);
    cleanup();
    openAs('founder', [
      person(FOUNDER_MEMBER, 'manager', { role: 'founder' }),
      person(AYSE, 'owner'),
    ]);
    members = await section(2);
    expect(hints(members)).toEqual([true, false]);
    cleanup();

    // A manager.
    openAs('employee', [person(FOUNDER_MEMBER, 'manager'), person(AYSE, 'owner')]);
    members = await section(2);
    expect(hints(members)).toEqual([false, true]);
    cleanup();

    // Not the founder who is a manager of a project without an owner: the founder removes
    // managers and gives roles, so the manager's sentence would be false for them.
    openAs('founder', [
      person(FOUNDER_MEMBER, 'manager', { role: 'founder' }),
      person(AYSE, 'manager'),
    ]);
    members = await section(2);
    expect(hints(members)).toEqual([false, false]);
    cleanup();

    // A plain member.
    openAs('employee', [person(FOUNDER_MEMBER, 'member'), person(AYSE, 'owner')]);
    members = await section(2);
    expect(hints(members)).toEqual([false, false]);
  });

  it("members: the founder who is no member manages every row except the owner's button, and reads the founder's words in the hand-over", async () => {
    const api = openAs('founder', [
      person(AYSE, 'owner'),
      person(CAGAN, 'manager'),
      person(DENIZ, 'member'),
    ]);
    const members = await section(3);
    // The founder is no row of the list.
    expect(within(members).queryByText(/\(siz\)/)).toBeNull();
    expect(within(row('Ayşe Yılmaz')).queryByRole('button')).toBeNull();
    for (const name of ['Çağan Ünal', 'Deniz Öz']) {
      expect(
        within(row(name))
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Rolü değiştir', 'Projeden çıkar']);
    }
    expect(await within(members).findByRole('combobox', { name: 'Eklenecek kişi' })).toBeVisible();

    await userEvent.click(
      within(await openRoleMenu('Deniz Öz')).getByRole('menuitem', { name: 'Sahipliği devret' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Sahiplik Deniz Öz adlı üyeye devredilsin mi?',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Projenin sahibi bu kişi olur. Şimdiki sahip üye olarak kalır.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sahipliği devret' }));
    expect(await screen.findByText('Projenin yeni sahibi: Deniz Öz.')).toBeVisible();
    expect(api.callsTo(roleRoute(DENIZ.userId))[0]?.body).toEqual({ role: 'owner' });
    // The former owner is a plain member the founder manages like any other.
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');
    expect(lineOf('Deniz Öz')).toBe('Sahip, Çalışan');
    expect(within(row('Deniz Öz')).queryByRole('button')).toBeNull();
    expect(
      within(row('Ayşe Yılmaz'))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Rolü değiştir', 'Projeden çıkar']);
    expect(api.unexpected).toEqual([]);
  });

  it('members: the founder who owns the project is told only that they stay a member', async () => {
    // The founder does in every project what its owner does, so the owner's sentence about the
    // rights that go away would be false for them.
    openAs('founder', [
      person(FOUNDER_MEMBER, 'owner', { role: 'founder' }),
      person(AYSE, 'member'),
    ]);
    await section(2);
    await userEvent.click(
      within(await openRoleMenu('Ayşe Yılmaz')).getByRole('menuitem', { name: 'Sahipliği devret' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleDescription(
      'Projenin sahibi bu kişi olur. Siz üye olarak kalırsınız.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sahipliği devret' }));
    expect(await screen.findByText('Projenin yeni sahibi: Ayşe Yılmaz.')).toBeVisible();
    // The founder still manages the members: their own row can now be taken off or given a role.
    expect(
      within(row(MINE))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Rolü değiştir', 'Projeden çıkar']);
  });

  it("members: a project without an owner says so, in the founder's words and in an employee's", async () => {
    const FOR_FOUNDER = 'Bu projenin sahibi yok. Bir üyeyi sahip yapabilirsiniz.';
    const FOR_OTHERS = 'Bu projenin sahibi yok. Sahibi kurucu atar.';
    openAs('founder', [person(AYSE, 'manager'), person(CAGAN, 'member')]);
    let members = await section(2);
    const sentence = within(members).getByText(FOR_FOUNDER);
    // Between the heading and the list.
    expect(within(members).getByRole('heading', { level: 3 }).nextElementSibling).toBe(sentence);
    expect(sentence.nextElementSibling).toBe(within(members).getByRole('list'));
    // Nothing about a hand-over: there is no owner to hand over from.
    expect(within(members).queryByText(MEMBERS_TEXT.handOverHint)).toBeNull();
    // The founder names the owner with the same act, and is told nothing about a former owner.
    await userEvent.click(
      within(await openRoleMenu('Çağan Ünal')).getByRole('menuitem', { name: 'Sahipliği devret' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Sahiplik Çağan Ünal adlı üyeye devredilsin mi?',
    });
    expect(dialog).toHaveAccessibleDescription('Projenin sahibi bu kişi olur.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sahipliği devret' }));
    expect(await screen.findByText('Projenin yeni sahibi: Çağan Ünal.')).toBeVisible();
    expect(within(members).queryByText(FOR_FOUNDER)).toBeNull();
    expect(within(members).getByText(MEMBERS_TEXT.handOverHint)).toBeVisible();
    cleanup();

    openAs('employee', [person(FOUNDER_MEMBER, 'manager'), person(AYSE, 'member')]);
    members = await section(2);
    expect(within(members).getByText(FOR_OTHERS)).toBeVisible();
    expect(within(members).queryByText(FOR_FOUNDER)).toBeNull();
    cleanup();

    // A project with an owner says neither; one without any member keeps its own sentence.
    openAs('employee', [person(FOUNDER_MEMBER, 'member'), person(AYSE, 'owner')]);
    members = await section(2);
    expect(within(members).queryByText(/Bu projenin sahibi yok/)).toBeNull();
    cleanup();
    openAs('founder', []);
    members = await section(0);
    expect(
      within(members).getByText('Bu projenin üyesi yok. Projeyi yalnızca kurucu görür.'),
    ).toBeVisible();
    expect(within(members).queryByText(/Bu projenin sahibi yok/)).toBeNull();
  });

  it('members: a refusal of the API (project_owner_fixed, project_manager_protected, project_members_changed) is shown and the row stays', async () => {
    const OWNER_FIXED =
      'Sahibin rolü doğrudan değiştirilemez. Sahipliği devretmek için başka bir üyeyi sahip yapın.';
    const MANAGER_PROTECTED =
      'Bir yöneticiyi projeden yalnızca projenin sahibi ya da kurucu çıkarabilir.';
    const CHANGED = 'Projenin üyeleri az önce değişti. Sayfayı yenileyip yeniden deneyin.';
    const remove = `DELETE /projects/${PROJECT_ID}/members/${AYSE.userId}`;
    const api = openAs(
      'founder',
      [person(FOUNDER_MEMBER, 'owner', { role: 'founder' }), person(AYSE, 'member')],
      {
        // Somebody else changed the roles meanwhile: the page is stale and the API refuses.
        [roleRoute(AYSE.userId)]: () => apiError(409, 'project_owner_fixed', OWNER_FIXED),
        [remove]: () => apiError(403, 'project_manager_protected', MANAGER_PROTECTED),
      },
    );
    await section(2);

    // A role given at once: the refusal is a message, the row and its line stay.
    await userEvent.click(
      within(await openRoleMenu('Ayşe Yılmaz')).getByRole('menuitem', { name: 'Yönetici yap' }),
    );
    expect(await screen.findByText(OWNER_FIXED)).toBeVisible();
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');
    expect(screen.queryByText('Ayşe Yılmaz yönetici yapıldı.')).toBeNull();
    await waitFor(() => {
      expect(roleButton('Ayşe Yılmaz')).not.toHaveAttribute('aria-disabled');
    });

    // The hand-over: the refusal is read in the confirmation, which stays open.
    await userEvent.click(
      within(await openRoleMenu('Ayşe Yılmaz')).getByRole('menuitem', { name: 'Sahipliği devret' }),
    );
    let dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sahipliği devret' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(OWNER_FIXED);
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.queryByText('Projenin yeni sahibi: Ayşe Yılmaz.')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(lineOf('Ayşe Yılmaz')).toBe('Üye, Çalışan');
    expect(lineOf(MINE)).toBe('Sahip, Kurucu');

    // A removal: both refusals are read in its confirmation.
    await userEvent.click(
      within(row('Ayşe Yılmaz')).getByRole('button', { name: 'Projeden çıkar' }),
    );
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Projeden çıkar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(MANAGER_PROTECTED);
    api.handle(remove, () => apiError(409, 'project_members_changed', CHANGED));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Projeden çıkar' }));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(CHANGED);
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(row('Ayşe Yılmaz')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Üyeler 2' })).toBeVisible();
    expect(api.unexpected).toEqual([]);
  });
});

describe('projects: permissions', () => {
  const CUSTOMER_OPEN = {
    id: CUSTOMER_ID,
    name: 'Beta Lojistik',
    aiAllowed: true,
    automatedProcessingAllowed: false,
  };
  const OTHER_CUSTOMER = {
    id: OTHER_CUSTOMER_ID,
    name: 'Gama Enerji',
    aiAllowed: true,
    automatedProcessingAllowed: false,
  };
  const AI = `PUT /projects/${PROJECT_ID}/ai-permission`;
  const CONTRACT = `PATCH /customers/${CUSTOMER_ID}/permissions`;
  const aiSection = () => within(panel()).getByRole('region', { name: 'Yapay zekâ izni' });
  const contractSection = () =>
    within(panel()).getByRole('region', { name: 'Müşterinin sözleşmesi' });
  const aiSwitch = () => within(aiSection()).getByRole('switch', { name: 'Yapay zekâ izni' });
  // While a confirmation is open the page behind it is hidden from assistive technology.
  const aiSwitchBehindDialog = () =>
    screen.getByRole('switch', { name: 'Yapay zekâ izni', hidden: true });
  const ready = async (button: HTMLElement) => {
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled');
    });
    return button;
  };
  const closed = async () => {
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  };

  beforeEach(() => {
    // The panel shows by itself in a wide window.
    stubMatchMedia([WIDE_WINDOW_QUERY]);
  });

  it('AI permission: an employee sees the word and the sentences and no switch', async () => {
    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(within(aiSection()).getByText('İzin kapalı')).toBeVisible();
    expect(
      within(aiSection()).getByText('Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.'),
    ).toBeVisible();
    expect(within(aiSection()).getByText('İzni yalnızca kurucu değiştirir.')).toBeVisible();
    // No switch anywhere on the page for them, also not a disabled one.
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('AI permission: the founder turns it on with a passkey; the switch moves only when the API has stored it; the focus returns to the switch', async () => {
    const stepUp = stepUpIssuer();
    let answer: (response: Response) => void = () => undefined;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'POST /step-up/options': stepUp.handler,
        [AI]: () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(aiSwitch()).not.toBeChecked();
    // The switch is described by the sentence about agents.
    expect(aiSwitch()).toHaveAccessibleDescription(
      'Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.',
    );
    // The founder has no "only the founder" sentence.
    expect(within(aiSection()).queryByText('İzni yalnızca kurucu değiştirir.')).toBeNull();

    await userEvent.click(aiSwitch());
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Depo otomasyonu için yapay zekâ izni açılsın mı?',
    });
    // The customer's contract permission is closed: the dialog says that agents still cannot work.
    expect(dialog).toHaveTextContent(
      'İzin açılınca ajanlar bu projede çalışabilir ve projenin kayıtları yapay zekâ modeline gönderilebilir. Projenin müşterisi varsa izni yalnızca müşterinin sözleşmesi yapay zekâ kullanımına izin veriyorsa açın. İzin açıkken projenin müşterisi değiştirilemez. Müşterinin sözleşme izni kapalı olduğu için ajanlar yine de çalışamaz.',
    );
    // The click changed nothing: the switch keeps the saved value and nothing was sent.
    expect(aiSwitchBehindDialog()).not.toBeChecked();
    expect(api.callsTo(AI)).toEqual([]);
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    // The passkey is bound to this project, this act and the customer the page shows.
    expect(stepUp.issued[0]?.body).toEqual({
      purpose: 'project_ai_permission',
      companyId: ARMADX.companyId,
      subjectId: PROJECT_ID,
      details: { action: 'open', customerId: CUSTOMER_ID },
    });
    await userEvent.click(await ready(within(dialog).getByRole('button', { name: 'İzni aç' })));
    await waitFor(() => {
      expect(api.callsTo(AI)).toHaveLength(1);
    });
    expect(api.callsTo(AI)[0]?.body).toEqual({
      allowed: true,
      customerId: CUSTOMER_ID,
      stepUp: signed(challengeId(1)),
    });
    // Still on its way: the switch has not moved.
    expect(aiSwitchBehindDialog()).not.toBeChecked();

    answer(json(projectDetail({ aiAllowed: true, agentsMayWork: false })));
    await closed();
    expect(aiSwitch()).toBeChecked();
    expect(within(aiSection()).getByText('İzin açık')).toBeVisible();
    await waitFor(() => {
      expect(aiSwitch()).toHaveFocus();
    });
    // The page was not asked again: the answer of the change is the project.
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
  });

  it('AI permission: a project without a customer is confirmed for no customer, without the sentence about the contract', async () => {
    const stepUp = stepUpIssuer();
    const api = mockApi(
      projectHandlers(projectDetail({ customer: null }), {
        'POST /step-up/options': stepUp.handler,
        [AI]: () => json(projectDetail({ customer: null, aiAllowed: true, agentsMayWork: true })),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    await userEvent.click(aiSwitch());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).not.toHaveTextContent('ajanlar yine de çalışamaz');
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    expect(stepUp.issued[0]?.body).toMatchObject({
      details: { action: 'open', customerId: null },
    });
    await userEvent.click(await ready(within(dialog).getByRole('button', { name: 'İzni aç' })));
    await waitFor(() => {
      expect(aiSwitch()).toBeChecked();
    });
    expect(api.callsTo(AI)[0]?.body).toEqual({
      allowed: true,
      customerId: null,
      stepUp: signed(challengeId(1)),
    });
    expect(within(aiSection()).getByText('Bu projede ajanlar çalışabilir.')).toBeVisible();
  });

  it('AI permission: turning it off asks plainly and sends no stepUp', async () => {
    const open = projectDetail({ aiAllowed: true, agentsMayWork: true, customer: CUSTOMER_OPEN });
    const api = mockApi(
      projectHandlers(open, {
        [AI]: () => json(projectDetail({ aiAllowed: false, customer: CUSTOMER_OPEN })),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(aiSwitch()).toBeChecked();
    await userEvent.click(aiSwitch());
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Depo otomasyonu için yapay zekâ izni kapatılsın mı?',
    });
    expect(dialog).toHaveTextContent(
      'Ajanlar bu projede artık çalışamaz. İzni yeniden açmak passkey ister.',
    );
    // The safe button has the focus; giving up sends nothing and returns the focus to the switch.
    expect(within(dialog).getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(api.callsTo(AI)).toEqual([]);
    await waitFor(() => {
      expect(aiSwitch()).toHaveFocus();
    });
    expect(aiSwitch()).toBeChecked();

    await userEvent.click(aiSwitch());
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'İzni kapat' }),
    );
    await closed();
    expect(aiSwitch()).not.toBeChecked();
    expect(within(aiSection()).getByText('İzin kapalı')).toBeVisible();
    // Closing needs no passkey: no options were asked for and the body carries none.
    expect(api.callsTo(AI).map((call) => call.body)).toEqual([{ allowed: false }]);
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(aiSwitch()).toHaveFocus();
    });
  });

  it("AI permission: the API's refusal shows in the dialog and the switch stays", async () => {
    const stepUp = stepUpIssuer();
    const open = projectDetail({ aiAllowed: true, agentsMayWork: true, customer: CUSTOMER_OPEN });
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'POST /step-up/options': stepUp.handler,
        [AI]: () => apiError(403, 'founder_only', 'Bu işlemi yalnızca kurucu yapabilir.'),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    // Opening, with a passkey.
    await userEvent.click(aiSwitch());
    let dialog = await screen.findByRole('alertdialog');
    await userEvent.click(await ready(within(dialog).getByRole('button', { name: 'İzni aç' })));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bu işlemi yalnızca kurucu yapabilir.',
    );
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(aiSwitchBehindDialog()).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await closed();
    expect(aiSwitch()).not.toBeChecked();
    cleanup();

    // Closing, plainly.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(open));
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    await userEvent.click(aiSwitch());
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'İzni kapat' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bu işlemi yalnızca kurucu yapabilir.',
    );
    expect(aiSwitchBehindDialog()).toBeChecked();
  });

  it("AI permission: when the project's customer changed meanwhile the confirmation closes, the page says so and reads the project again", async () => {
    const stepUp = stepUpIssuer();
    const sentence =
      'Bu projenin müşterisi az önce değişti. Projeye yeniden bakın; izni açmak için yeniden onaylayın.';
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'POST /step-up/options': stepUp.handler,
        [AI]: () => apiError(409, 'project_changed', sentence),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf(panel(), 'Müşteri')).toHaveTextContent('Beta Lojistik');
    await userEvent.click(aiSwitch());
    const dialog = await screen.findByRole('alertdialog');
    const confirm = await ready(within(dialog).getByRole('button', { name: 'İzni aç' }));
    // A member gave the project another customer after the founder opened the page.
    api.handle(`GET /projects/${PROJECT_ID}`, () =>
      json(projectDetail({ customer: OTHER_CUSTOMER })),
    );
    await userEvent.click(confirm);
    // The founder is not left confirming, behind a dialog, a customer they have not looked at.
    await closed();
    expect(within(aiSection()).getByRole('alert')).toHaveTextContent(sentence);
    await waitFor(() => {
      expect(valueOf(panel(), 'Müşteri')).toHaveTextContent('Gama Enerji');
    });
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(2);
    expect(aiSwitch()).not.toBeChecked();
    await waitFor(() => {
      expect(aiSwitch()).toHaveFocus();
    });

    // Confirming anew is for the customer the page now shows, with a new passkey prompt.
    api.handle(AI, () =>
      json(projectDetail({ aiAllowed: true, agentsMayWork: true, customer: OTHER_CUSTOMER })),
    );
    await userEvent.click(aiSwitch());
    // The sentence goes when the founder acts on it.
    expect(screen.queryByText(sentence)).toBeNull();
    await userEvent.click(
      await ready(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'İzni aç' }),
      ),
    );
    await waitFor(() => {
      expect(aiSwitch()).toBeChecked();
    });
    expect(stepUp.issued.at(-1)?.body).toMatchObject({
      subjectId: PROJECT_ID,
      details: { action: 'open', customerId: OTHER_CUSTOMER_ID },
    });
    expect(api.callsTo(AI).at(-1)?.body).toMatchObject({
      allowed: true,
      customerId: OTHER_CUSTOMER_ID,
    });
  });

  it('AI permission: an open confirmation stays for the customer the founder saw when the page reads the project again; the API then refuses and the page says so', async () => {
    const stepUp = stepUpIssuer();
    const sentence =
      'Bu projenin müşterisi az önce değişti. Projeye yeniden bakın; izni açmak için yeniden onaylayın.';
    const contractClosed = 'Müşterinin sözleşme izni kapalı olduğu için ajanlar yine de çalışamaz.';
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'POST /step-up/options': stepUp.handler,
        [AI]: () => apiError(409, 'project_changed', sentence),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    await userEvent.click(aiSwitch());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(contractClosed);
    await ready(within(dialog).getByRole('button', { name: 'İzni aç' }));
    // A member takes the customer off the project while the founder looks at the contract in
    // another tab; coming back reads the project again under the open confirmation.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail({ customer: null })));
    comeBackToTheTab();
    await waitFor(() => {
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(2);
    });
    // The page behind the dialog has the new answer ...
    await screen.findByText('Müşteri yok');
    // ... and the confirmation is still the one that was asked: its words and what it is bound to.
    expect(dialog).toHaveTextContent(contractClosed);
    await userEvent.click(await ready(within(dialog).getByRole('button', { name: 'İzni aç' })));
    await closed();
    expect(stepUp.issued.length).toBeGreaterThan(0);
    for (const issued of stepUp.issued) {
      expect(issued.body).toMatchObject({
        subjectId: PROJECT_ID,
        details: { action: 'open', customerId: CUSTOMER_ID },
      });
    }
    expect(api.callsTo(AI).map((call) => call.body)).toEqual([
      expect.objectContaining({ allowed: true, customerId: CUSTOMER_ID }),
    ]);
    // Nothing was opened for a customer the founder did not look at: the API refused, and the
    // page says what happened.
    expect(within(aiSection()).getByRole('alert')).toHaveTextContent(sentence);
    expect(aiSwitch()).not.toBeChecked();
    expect(valueOf(panel(), 'Müşteri')).toHaveTextContent('Müşteri yok');
  });

  it('customer permissions: an open confirmation stays for the customer it was opened for when the project gets another customer meanwhile, with a passkey and without', async () => {
    const stepUp = stepUpIssuer();
    const beta = { ...CUSTOMER_OPEN, aiAllowed: false };
    const gama = { ...OTHER_CUSTOMER, aiAllowed: false };
    const OTHER_CONTRACT = `PATCH /customers/${OTHER_CUSTOMER_ID}/permissions`;
    const api = mockApi(
      projectHandlers(projectDetail({ customer: beta }), {
        'POST /step-up/options': stepUp.handler,
        [CONTRACT]: () => json({ ...beta, aiAllowed: true }),
        [OTHER_CONTRACT]: () => json({ ...gama, automatedProcessingAllowed: true }),
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    await userEvent.click(
      within(contractSection()).getByRole('switch', {
        name: 'Sözleşme yapay zekâ kullanımına izin veriyor',
      }),
    );
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Beta Lojistik için yapay zekâ izni açılsın mı?',
    });
    await ready(within(dialog).getByRole('button', { name: 'İzni aç' }));
    // A member gives the project another customer; the page reads the project again.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail({ customer: gama })));
    comeBackToTheTab();
    await screen.findByText('Gama Enerji');
    // The confirmation does not move to the other customer: not its title, not its passkey, not
    // its request.
    expect(
      screen.getByRole('alertdialog', { name: 'Beta Lojistik için yapay zekâ izni açılsın mı?' }),
    ).toBe(dialog);
    await userEvent.click(await ready(within(dialog).getByRole('button', { name: 'İzni aç' })));
    await closed();
    expect(stepUp.issued.length).toBeGreaterThan(0);
    for (const issued of stepUp.issued) {
      expect(issued.body).toMatchObject({
        purpose: 'customer_ai_permission',
        subjectId: CUSTOMER_ID,
      });
    }
    expect(api.callsTo(CONTRACT).map((call) => call.body)).toEqual([
      { aiAllowed: true, stepUp: signed(stepUp.issued.at(-1)?.challengeId ?? '') },
    ]);
    expect(api.callsTo(OTHER_CONTRACT)).toEqual([]);

    // The same for a confirmation without a passkey: opened for Gama Enerji, the page then shows
    // Beta Lojistik again.
    await waitFor(() => {
      expect(valueOf(panel(), 'Müşteri')).toHaveTextContent('Gama Enerji');
    });
    await userEvent.click(
      within(contractSection()).getByRole('switch', {
        name: 'Sözleşme kodla otomatik işlemeye izin veriyor',
      }),
    );
    dialog = await screen.findByRole('alertdialog', {
      name: 'Gama Enerji için kodla otomatik işleme izni açılsın mı?',
    });
    const reads = api.callsTo(`GET /projects/${PROJECT_ID}`).length;
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail({ customer: beta })));
    comeBackToTheTab();
    await waitFor(() => {
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(reads + 1);
    });
    await screen.findByText('Beta Lojistik');
    expect(
      screen.getByRole('alertdialog', {
        name: 'Gama Enerji için kodla otomatik işleme izni açılsın mı?',
      }),
    ).toBe(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'İzni aç' }));
    await closed();
    expect(api.callsTo(OTHER_CONTRACT).map((call) => call.body)).toEqual([
      { automatedProcessingAllowed: true },
    ]);
    expect(api.callsTo(CONTRACT)).toHaveLength(1);
  });

  it('customer permissions: the founder turns the AI permission on with a passkey for the customer and automated processing with a plain confirmation; an employee sees one row and no switch', async () => {
    const stepUp = stepUpIssuer();
    let customer = { ...CUSTOMER_OPEN, aiAllowed: false };
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'POST /step-up/options': stepUp.handler,
        [`GET /projects/${PROJECT_ID}`]: () => json(projectDetail({ customer })),
        [CONTRACT]: (call) => {
          const body = call.body as { aiAllowed?: boolean; automatedProcessingAllowed?: boolean };
          customer = {
            ...customer,
            ...(body.aiAllowed === undefined ? {} : { aiAllowed: body.aiAllowed }),
            ...(body.automatedProcessingAllowed === undefined
              ? {}
              : { automatedProcessingAllowed: body.automatedProcessingAllowed }),
          };
          return json(customer);
        },
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const ai = () =>
      within(contractSection()).getByRole('switch', {
        name: 'Sözleşme yapay zekâ kullanımına izin veriyor',
      });
    const automated = () =>
      within(contractSection()).getByRole('switch', {
        name: 'Sözleşme kodla otomatik işlemeye izin veriyor',
      });
    expect(ai()).not.toBeChecked();
    expect(automated()).not.toBeChecked();
    expect(
      within(contractSection()).getByText('Bu izinler müşterinin bütün projeleri için geçerlidir.'),
    ).toBeVisible();

    // The contract's AI permission: a passkey bound to this customer.
    await userEvent.click(ai());
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Beta Lojistik için yapay zekâ izni açılsın mı?',
    });
    expect(dialog).toHaveTextContent(
      'Sözleşmenin yapay zekâ kullanımına izin verdiğini işaretliyorsunuz. Bu izin müşterinin bütün projeleri için geçerlidir; ajanlar yalnızca yapay zekâ izni açık projelerde çalışır.',
    );
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    expect(stepUp.issued[0]?.body).toEqual({
      purpose: 'customer_ai_permission',
      companyId: ARMADX.companyId,
      subjectId: CUSTOMER_ID,
      details: { action: 'update', aiAllowed: true },
    });
    await userEvent.click(await ready(within(dialog).getByRole('button', { name: 'İzni aç' })));
    await closed();
    expect(api.callsTo(CONTRACT)[0]?.body).toEqual({
      aiAllowed: true,
      stepUp: signed(challengeId(1)),
    });
    // The page was read again and the switch shows what the API stored.
    expect(ai()).toBeChecked();
    expect(valueOf(contractSection(), 'Yapay zekâ kullanımı')).toHaveTextContent('İzin var');
    await waitFor(() => {
      expect(ai()).toHaveFocus();
    });

    // Automated processing: a plain confirmation, no passkey.
    await userEvent.click(automated());
    dialog = await screen.findByRole('alertdialog', {
      name: 'Beta Lojistik için kodla otomatik işleme izni açılsın mı?',
    });
    expect(dialog).toHaveTextContent(
      'Sözleşmenin kodla yapılan otomatik işlemeye izin verdiğini işaretliyorsunuz. Hatırlatma gibi model kullanmayan otomatik işler bu müşteri için çalışabilir.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'İzni aç' }));
    await closed();
    expect(automated()).toBeChecked();
    expect(api.callsTo(CONTRACT)[1]?.body).toEqual({ automatedProcessingAllowed: true });
    expect(stepUp.issued).toHaveLength(1);

    // ... and off again, plainly.
    await userEvent.click(automated());
    dialog = await screen.findByRole('alertdialog', {
      name: 'Beta Lojistik için kodla otomatik işleme izni kapatılsın mı?',
    });
    expect(dialog).toHaveTextContent(
      'Hatırlatma gibi model kullanmayan otomatik işler de bu müşteri için durur.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'İzni kapat' }));
    await closed();
    expect(automated()).not.toBeChecked();
    expect(api.callsTo(CONTRACT)[2]?.body).toEqual({ automatedProcessingAllowed: false });
    cleanup();

    // An employee: one row, in words, and no switch.
    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf(contractSection(), 'Yapay zekâ kullanımı')).toHaveTextContent('İzin yok');
    expect(within(contractSection()).queryByText('Kodla otomatik işleme')).toBeNull();
    expect(within(contractSection()).queryByRole('switch')).toBeNull();
  });

  it("customer permissions: turning the customer's AI permission off asks plainly and sends no stepUp; an employee reads who changes the permissions", async () => {
    let customer = CUSTOMER_OPEN;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [`GET /projects/${PROJECT_ID}`]: () =>
          json(projectDetail({ aiAllowed: true, agentsMayWork: customer.aiAllowed, customer })),
        [CONTRACT]: () => {
          customer = { ...customer, aiAllowed: false };
          return json(customer);
        },
      }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const ai = () =>
      within(contractSection()).getByRole('switch', {
        name: 'Sözleşme yapay zekâ kullanımına izin veriyor',
      });
    expect(ai()).toBeChecked();
    await userEvent.click(ai());
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Beta Lojistik için yapay zekâ izni kapatılsın mı?',
    });
    expect(dialog).toHaveTextContent(
      'Bu müşterinin bütün projelerinde ajanlar artık çalışamaz. İzni yeniden açmak passkey ister.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'İzni kapat' }));
    await closed();
    expect(api.callsTo(CONTRACT).map((call) => call.body)).toEqual([{ aiAllowed: false }]);
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(ai()).not.toBeChecked();
    // The project's own permission is still open; the page says why agents stopped.
    expect(aiSwitch()).toBeChecked();
    expect(
      within(aiSection()).getByText(
        'Bu projede ajanlar çalışamaz: müşterinin sözleşmesi yapay zekâ kullanımına izin vermiyor.',
      ),
    ).toBeVisible();
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(
      within(contractSection()).getByText('İzinleri yalnızca kurucu değiştirir.'),
    ).toBeVisible();
  });
});

describe('projects: editing', () => {
  const PATCH = `PATCH /projects/${PROJECT_ID}`;
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Projeyi düzenle' }));
    return screen.findByRole('dialog', { name: 'Projeyi düzenle' });
  };
  const gone = async () => {
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  };

  it('edit: sends only what changed; with nothing changed nothing is sent', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: () =>
          json(
            projectDetail({
              name: 'Depo otomasyonu 2',
              color: 'purple',
              targetDate: null,
              customer: {
                id: OTHER_CUSTOMER_ID,
                name: 'Gama Enerji',
                aiAllowed: true,
                automatedProcessingAllowed: false,
              },
            }),
          ),
      }),
    );
    renderApp(PAGE);
    let dialog = await openDialog();
    expect(dialog).toHaveTextContent('Üyeler ve yapay zekâ izni proje sayfasından değiştirilir.');
    // Filled from the project, the name first and focused.
    const name = within(dialog).getByRole('textbox', { name: 'Proje adı' });
    expect(name).toHaveValue('Depo otomasyonu');
    expect(name).toHaveFocus();
    expect(within(dialog).getByRole('textbox', { name: 'Açıklama' })).toHaveValue(
      'Depo süreçlerinin çıkarılması.\nİkinci satır.',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Müşteri' })).toHaveValue(CUSTOMER_ID);
    expect(within(dialog).getByRole('combobox', { name: 'Durum' })).toHaveValue('in_progress');
    expect(within(dialog).getByRole('radio', { name: 'Turkuaz' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Kutu' })).toBeChecked();
    expect(within(dialog).getByLabelText('Hedef tarih')).toHaveValue('2026-11-20');
    // No members field and no permission switch in this dialog.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('switch')).toBeNull();

    // Nothing changed: the dialog closes and nothing is sent.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(PATCH)).toEqual([]);

    dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Proje adı' }), ' 2');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Mor' }));
    await userEvent.clear(within(dialog).getByLabelText('Hedef tarih'));
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'Gama Enerji' })).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Müşteri' }),
      OTHER_CUSTOMER_ID,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    // Only the four fields that differ; the description, the status and the icon are not sent.
    expect(api.callsTo(PATCH).map((call) => call.body)).toEqual([
      {
        name: 'Depo otomasyonu 2',
        customer: { kind: 'existing', customerId: OTHER_CUSTOMER_ID },
        color: 'purple',
        targetDate: null,
      },
    ]);
    // The page shows the answer without asking again.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu 2' }),
    ).toBeVisible();
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
  });

  it('edit: a project that is read again under the open dialog does not make the form send what the person did not touch', async () => {
    // What another member did meanwhile: a new name, closed, another colour, no customer.
    const byOther = {
      name: 'Depo otomasyonu (yeni ad)',
      status: 'completed',
      closed: true,
      color: 'red',
      customer: null,
    } as const;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: () => json(projectDetail({ ...byOther, description: 'Yeni açıklama' })),
        // Without the list the select has only the customer the form was filled with to offer.
        'GET /customers': () => apiError(500, 'internal_error', 'Beklenmeyen bir hata oluştu.'),
      }),
    );
    renderApp(PAGE);
    const dialog = await openDialog();
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail(byOther)));
    comeBackToTheTab();
    // The page behind the dialog shows the other member's change.
    await screen.findByRole('heading', { level: 2, name: byOther.name, hidden: true });
    // The form keeps what it was opened with ...
    expect(within(dialog).getByRole('textbox', { name: 'Proje adı' })).toHaveValue(
      'Depo otomasyonu',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Müşteri' })).toHaveValue(CUSTOMER_ID);
    expect(within(dialog).getByRole('combobox', { name: 'Durum' })).toHaveValue('in_progress');
    expect(within(dialog).getByRole('radio', { name: 'Turkuaz' })).toBeChecked();
    // ... and sends only the field the person changed: the project is not renamed back, opened
    // again or given its customer back.
    const description = within(dialog).getByRole('textbox', { name: 'Açıklama' });
    await userEvent.clear(description);
    await userEvent.type(description, 'Yeni açıklama');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(PATCH).map((call) => call.body)).toEqual([{ description: 'Yeni açıklama' }]);
    expect(await screen.findByRole('heading', { level: 2, name: byOther.name })).toBeVisible();
  });

  it('edit: an AI permission opened under the open dialog turns the customer into text, and a customer chosen before that is not sent', async () => {
    const open = { aiAllowed: true, agentsMayWork: false };
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: () => json(projectDetail({ ...open, name: 'Yeni ad' })),
      }),
    );
    renderApp(PAGE);
    const dialog = await openDialog();
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'Gama Enerji' })).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Müşteri' }),
      OTHER_CUSTOMER_ID,
    );
    const name = within(dialog).getByRole('textbox', { name: 'Proje adı' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Yeni ad');
    // The founder opens the permission meanwhile; the page reads the project again.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail(open)));
    comeBackToTheTab();
    await waitFor(() => {
      expect(within(dialog).queryByRole('combobox', { name: 'Müşteri' })).toBeNull();
    });
    expect(within(dialog).getByText('Beta Lojistik')).toBeVisible();
    expect(name).toHaveValue('Yeni ad');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(PATCH).map((call) => call.body)).toEqual([{ name: 'Yeni ad' }]);
  });

  it('edit: after customer_not_found the choice goes back to the customer the form was opened with, and the list is read again', async () => {
    const notFound = 'Seçilen müşteri bulunamadı. Listeden yeniden seçin.';
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: () => apiError(409, 'customer_not_found', notFound),
      }),
    );
    renderApp(PAGE);
    const dialog = await openDialog();
    const customer = within(dialog).getByRole('combobox', { name: 'Müşteri' });
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'Gama Enerji' })).toBeInTheDocument();
    });
    // Another member takes the customer off the project; the page reads the project again.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail({ customer: null })));
    comeBackToTheTab();
    await waitFor(() => {
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText('Müşteri yok').some((element) => element.tagName === 'DD')).toBe(
        true,
      );
    });
    await userEvent.selectOptions(customer, OTHER_CUSTOMER_ID);
    const lists = api.callsTo('GET /customers').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(notFound);
    // The form is back at what it was opened with, not at what the page shows by now.
    expect(customer).toHaveValue(CUSTOMER_ID);
    await waitFor(() => {
      expect(api.callsTo('GET /customers')).toHaveLength(lists + 1);
    });
    expect(api.callsTo(PATCH).map((call) => call.body)).toEqual([
      { customer: { kind: 'existing', customerId: OTHER_CUSTOMER_ID } },
    ]);
  });

  it('edit: Tamamlandı says that it closes the project; the page then shows it closed; Planlandı opens it again', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: (call) => {
          const status = (call.body as { status: 'completed' | 'planned' }).status;
          return json(projectDetail({ status, closed: status === 'completed' }));
        },
      }),
    );
    renderApp(PAGE);
    let dialog = await openDialog();
    const note = 'Tamamlandı ve İptal projeyi kapatır; proje silinmez ve yeniden açılabilir.';
    expect(within(dialog).queryByText(note)).toBeNull();
    const status = within(dialog).getByRole('combobox', { name: 'Durum' });
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Beklemede', 'Planlandı', 'Sürüyor', 'Tamamlandı', 'İptal']);
    await userEvent.selectOptions(status, 'cancelled');
    expect(within(dialog).getByText(note)).toBeVisible();
    await userEvent.selectOptions(status, 'completed');
    expect(status).toHaveAccessibleDescription(note);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(PATCH)[0]?.body).toEqual({ status: 'completed' });
    const closedSentence =
      'Bu proje kapalı. Yeniden açmak için Projeyi düzenle ile durumunu Beklemede, Planlandı ya da Sürüyor yapın.';
    expect(await screen.findByText(closedSentence)).toBeVisible();
    expect(screen.getByText('Tamamlandı', { selector: 'header span' })).toBeVisible();

    // Opened again by the same field; nothing was deleted, nothing else is asked for.
    dialog = await openDialog();
    const again = within(dialog).getByRole('combobox', { name: 'Durum' });
    expect(again).toHaveValue('completed');
    expect(within(dialog).getByText(note)).toBeVisible();
    await userEvent.selectOptions(again, 'planned');
    expect(within(dialog).queryByText(note)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(PATCH)[1]?.body).toEqual({ status: 'planned' });
    await waitFor(() => {
      expect(screen.queryByText(closedSentence)).toBeNull();
    });
    expect(screen.getByText('Planlandı', { selector: 'header span' })).toBeVisible();
    expect(api.calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });

  it("edit: with the AI permission open the customer is text with its sentence, in the founder's words and in an employee's, and no customer is sent; project_customer_locked shows above the footer", async () => {
    const open = { aiAllowed: true, agentsMayWork: false };
    const api = mockApi(
      projectHandlers(projectDetail(open), {
        [PATCH]: () => json(projectDetail({ ...open, name: 'Yeni ad' })),
      }),
    );
    renderApp(PAGE);
    let dialog = await openDialog();
    // The customer is no field: its name as text, and what the founder does first.
    expect(within(dialog).queryByRole('combobox', { name: 'Müşteri' })).toBeNull();
    expect(within(dialog).getByText('Beta Lojistik')).toBeVisible();
    expect(
      within(dialog).getByText(
        'Yapay zekâ izni açıkken müşteri değiştirilemez. Önce proje sayfasından izni kapatın; müşteriyi değiştirdikten sonra izni yeniden açabilirsiniz.',
      ),
    ).toBeVisible();
    const name = within(dialog).getByRole('textbox', { name: 'Proje adı' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Yeni ad');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(PATCH).map((call) => call.body)).toEqual([{ name: 'Yeni ad' }]);
    cleanup();

    // An employee, and a project without a customer.
    mockApi(
      projectHandlers(projectForEmployee({ ...open, customer: null, agentsMayWork: true }), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        'GET /customers': () => json({ customers: CUSTOMER_NAMES }),
      }),
    );
    renderApp(PAGE);
    dialog = await openDialog();
    expect(within(dialog).queryByRole('combobox', { name: 'Müşteri' })).toBeNull();
    expect(within(dialog).getByText('Müşteri yok')).toBeVisible();
    expect(
      within(dialog).getByText(
        'Yapay zekâ izni açıkken müşteri değiştirilemez. Kurucunun önce izni kapatması gerekir.',
      ),
    ).toBeVisible();
    cleanup();

    // The permission is opened while the dialog stands open: the API refuses the customer change.
    const locked =
      'Yapay zekâ izni açıkken projenin müşterisi değiştirilemez. Kurucu önce izni kapatır; müşteri değişince izni yeniden açar.';
    const racing = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: () => apiError(409, 'project_customer_locked', locked),
      }),
    );
    renderApp(PAGE);
    dialog = await openDialog();
    racing.handle(`GET /projects/${PROJECT_ID}`, () => json(projectDetail(open)));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Müşteri' }), '');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    // Above the footer, like every refusal that belongs to no field; the form stays.
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(locked);
    expect(
      alert.compareDocumentPosition(within(dialog).getByRole('button', { name: 'Kaydet' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The project was read again, and the dialog now shows the customer as text.
    await waitFor(() => {
      expect(within(dialog).queryByRole('combobox', { name: 'Müşteri' })).toBeNull();
    });
    expect(racing.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(2);
    expect(within(dialog).getByText('Beta Lojistik')).toBeVisible();
  });

  it("edit: a new customer added while editing shows the sentence about closed permissions, in the founder's words and in an employee's; Kaydet gives the focus back to Projeyi düzenle", async () => {
    const exists = 'Bu adla bir müşteri zaten var. Müşteriyi listeden seçin.';
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [PATCH]: () => apiError(409, 'customer_exists', exists),
      }),
    );
    renderApp(PAGE);
    let dialog = await openDialog();
    const select = within(dialog).getByRole('combobox', { name: 'Müşteri' });
    expect(within(dialog).queryByRole('textbox', { name: 'Müşteri adı' })).toBeNull();
    await userEvent.selectOptions(select, 'new');
    expect(
      within(dialog).getByText(
        'Yeni müşterinin sözleşme izinleri kapalı başlar. İzinleri proje sayfasından işaretleyebilirsiniz.',
      ),
    ).toBeVisible();
    // No permission can be marked in this dialog, by the founder either.
    expect(within(dialog).queryByRole('switch')).toBeNull();
    const customerName = within(dialog).getByRole('textbox', { name: 'Müşteri adı' });

    // Without a name nothing is sent.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByText('Müşteri adını yazın.')).toBeVisible();
    expect(customerName).toHaveFocus();
    expect(api.callsTo(PATCH)).toEqual([]);

    // A name that exists: the API's sentence stands under the name, which takes the focus.
    await userEvent.type(customerName, '  beta lojistik ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    const problem = await within(dialog).findByRole('alert');
    expect(problem).toHaveTextContent(exists);
    expect(customerName).toHaveAccessibleDescription(exists);
    await waitFor(() => {
      expect(customerName).toHaveFocus();
    });
    const [refused] = api.callsTo(PATCH);
    // A new customer of an edit carries a name and an id, never a permission.
    const sent = z
      .strictObject({
        customer: z.strictObject({ kind: z.literal('new'), id: z.uuid(), name: z.string() }),
      })
      .parse(refused?.body);
    expect(sent.customer.name).toBe('beta lojistik');

    api.handle(PATCH, () =>
      json(
        projectDetail({
          customer: {
            id: sent.customer.id,
            name: 'Delta',
            aiAllowed: false,
            automatedProcessingAllowed: false,
          },
        }),
      ),
    );
    await userEvent.clear(customerName);
    await userEvent.type(customerName, 'Delta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    // A send that is repeated names the same new customer.
    expect(api.callsTo(PATCH)[1]?.body).toEqual({
      customer: {
        kind: 'new',
        id: sent.customer.id,
        name: 'Delta',
      },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Projeyi düzenle' })).toHaveFocus();
    });
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        'GET /customers': () => json({ customers: CUSTOMER_NAMES }),
      }),
    );
    renderApp(PAGE);
    dialog = await openDialog();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Müşteri' }), 'new');
    expect(
      within(dialog).getByText(
        'Yeni müşterinin sözleşme izinleri kapalı başlar. İzinleri kurucu işaretler.',
      ),
    ).toBeVisible();
  });

  it('edit: Vazgeç and Escape close without a request and return the focus; a press outside does not close', async () => {
    const api = mockApi(projectHandlers());
    renderApp(PAGE);
    let dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Proje adı' }), ' x');
    // A slip of the pointer beside the dialog does not lose what was typed.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) throw new Error('The dialog has no overlay');
    await userEvent.click(overlay);
    expect(screen.getByRole('dialog', { name: 'Projeyi düzenle' })).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await gone();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Projeyi düzenle' })).toHaveFocus();
    });
    // Every opening starts from the project as it is: what was typed and given up is gone.
    dialog = await openDialog();
    expect(within(dialog).getByRole('textbox', { name: 'Proje adı' })).toHaveValue(
      'Depo otomasyonu',
    );
    await userEvent.keyboard('{Escape}');
    await gone();
    expect(api.callsTo(PATCH)).toEqual([]);
  });
});

describe('projects: a new project', () => {
  const NEW_ID = 'a7777777-7777-4777-8777-777777777777';
  const openNew = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni proje' }));
    return screen.findByRole('dialog', { name: 'Yeni proje' });
  };
  const create = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Projeyi oluştur' });
  const nameOf = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: 'Proje adı' });
  const customerOf = (dialog: HTMLElement) =>
    within(dialog).getByRole('combobox', { name: 'Müşteri' });
  /** What POST /projects carries, checked against the request contract. */
  const sentBody = (call: { body: unknown } | undefined) => createProjectSchema.parse(call?.body);
  /** A fake API that stores the project it is sent and can then show its page. */
  function creatingApi(extra: Record<string, Handler> = {}) {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        'POST /projects': (call) => {
          const body = sentBody(call);
          const created = projectDetail({
            id: body.id,
            name: body.name,
            status: body.status,
            color: body.color,
            icon: body.icon,
            targetDate: body.targetDate,
            customer: null,
            members: [FOUNDER_MEMBER],
          });
          api.handle(`GET /projects/${body.id}`, () => json(created));
          return json(created, 201);
        },
        ...extra,
      }),
    );
    return api;
  }
  const exists = 'Bu adla bir müşteri zaten var. Müşteriyi listeden seçin.';

  it('new project: the name has the focus; an empty name is said in Turkish and nothing is sent', async () => {
    const api = creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    expect(dialog).toHaveTextContent('Arma DX için açılır.');
    expect(nameOf(dialog)).toHaveFocus();
    expect(nameOf(dialog)).toHaveAttribute('aria-required', 'true');
    await userEvent.click(create(dialog));
    const problem = await within(dialog).findByRole('alert');
    expect(problem).toHaveTextContent('Proje adını yazın.');
    expect(nameOf(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(nameOf(dialog)).toHaveAccessibleDescription('Proje adını yazın.');
    // The first field that is wrong takes the focus.
    expect(nameOf(dialog)).toHaveFocus();
    expect(api.callsTo('POST /projects')).toEqual([]);
    // Typing a name takes the sentence away at the next send.
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /projects')).toHaveLength(1);
    });
  });

  it('new project: sends the id, the name, the description, no customer, the checked members, planned, gray, folder and no date, then opens the page', async () => {
    const api = creatingApi();
    const { router } = renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), '  Yeni depo ');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Açıklama' }),
      'İlk satır{Enter}ikinci',
    );
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Çağan Ünal' }));
    // The defaults a person sees before choosing anything.
    expect(customerOf(dialog)).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: 'Durum' })).toHaveValue('planned');
    expect(within(dialog).getByRole('radio', { name: 'Gri' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Klasör' })).toBeChecked();
    expect(within(dialog).getByLabelText('Hedef tarih')).toHaveValue('');
    await userEvent.click(create(dialog));

    const page = await screen.findByRole('heading', { level: 2, name: 'Yeni depo' });
    expect(page).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    const [call] = api.callsTo('POST /projects');
    expect(call?.body).toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) as string,
      name: 'Yeni depo',
      description: 'İlk satır\nikinci',
      customer: { kind: 'none' },
      memberIds: [CAGAN.userId],
      status: 'planned',
      color: 'gray',
      icon: 'folder',
      targetDate: null,
    });
    // The page is the confirmation; its address carries the id the panel chose.
    expect(currentLocation(router).pathname).toBe(`/c/armadx/projects/${sentBody(call).id}`);
    expect(api.unexpected).toEqual([]);
  });

  it('new project: the opener is checked and stays checked', async () => {
    creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    const members = within(dialog).getByRole('group', { name: 'Üyeler' });
    await within(members).findByRole('checkbox', { name: 'Ayşe Yılmaz' });
    // The opener first, then the others by name; the founder is not listed twice.
    expect(
      within(members)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['Ömer Kadıoğlu (siz)', 'Ayşe Yılmaz', 'Çağan Ünal']);
    const own = within(members).getByRole('checkbox', { name: 'Ömer Kadıoğlu (siz)' });
    expect(own).toBeChecked();
    expect(own).toHaveAttribute('aria-disabled', 'true');
    // Fixed, and still reachable with the keyboard.
    expect(own).not.toBeDisabled();
    await userEvent.click(own);
    expect(own).toBeChecked();
    expect(members).toHaveAccessibleDescription(
      'Projeyi ve ona bağlı kayıtları yalnızca üyeler ve kurucu görür. Projeyi açan kişi üyedir. Projeyi açan kişi projenin sahibi olur.',
    );
    expect(within(members).getByRole('checkbox', { name: 'Ayşe Yılmaz' })).not.toBeChecked();
  });

  it('new project: the help says that the opener becomes the owner', async () => {
    // 8 October decision 44: who opens a project is its owner, for an employee as for the founder.
    creatingApi({ 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) });
    renderApp(LIST);
    const dialog = await openNew();
    const members = within(dialog).getByRole('group', { name: 'Üyeler' });
    expect(within(members).getByText(/Projeyi açan kişi projenin sahibi olur\.$/)).toBeVisible();
  });

  it('new project: a customer by name; an employee sees no permission switch and the request carries closed permissions', async () => {
    const api = creatingApi({
      'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      'GET /customers': () => json({ customers: CUSTOMER_NAMES }),
    });
    renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.selectOptions(customerOf(dialog), 'new');
    expect(
      within(dialog).getByText(
        'Yeni müşterinin sözleşme izinleri kapalı başlar. İzinleri kurucu işaretler.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('switch')).toBeNull();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Müşteri adı' }), ' Delta ');
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /projects')).toHaveLength(1);
    });
    const body = sentBody(api.callsTo('POST /projects')[0]);
    expect(body.customer).toEqual({
      kind: 'new',
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      name: 'Delta',
      aiAllowed: false,
      automatedProcessingAllowed: false,
    });
    expect(body.stepUp).toBeUndefined();
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
  });

  it("new project: the founder marks the customer's AI permission and confirms with a passkey; the options are asked for the new customer's id and the request carries stepUp", async () => {
    const stepUp = stepUpIssuer();
    const api = creatingApi({ 'POST /step-up/options': stepUp.handler });
    renderApp(LIST);
    const form = await openNew();
    await userEvent.type(nameOf(form), 'Depo');
    await userEvent.selectOptions(customerOf(form), 'new');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Müşteri adı' }), 'Delta');
    const ai = within(form).getByRole('switch', {
      name: 'Sözleşme yapay zekâ kullanımına izin veriyor',
    });
    expect(ai).not.toBeChecked();
    expect(ai).toHaveAccessibleDescription(
      'Açarsanız projeyi passkey ile onaylayarak oluşturursunuz. Kapalıyken bu müşterinin projelerinde ajanlar çalışamaz.',
    );
    expect(
      within(form).getByRole('switch', { name: 'Sözleşme kodla otomatik işlemeye izin veriyor' }),
    ).toHaveAccessibleDescription(
      'Kapalıyken hatırlatma gibi model kullanmayan otomatik işler de bu müşteri için durur.',
    );
    await userEvent.click(ai);
    await userEvent.click(create(form));

    // The same dialog shows its second view; nothing was sent yet.
    const step = await screen.findByRole('dialog', {
      name: 'Müşterinin yapay zekâ izni açılsın mı?',
    });
    expect(step).toHaveTextContent(
      'Delta için sözleşmenin yapay zekâ kullanımına izin verdiğini işaretlediniz. Proje ve müşteri, passkey ile onayladığınızda oluşturulur.',
    );
    expect(within(step).getByRole('heading', { level: 2 })).toHaveFocus();
    expect(api.callsTo('POST /projects')).toEqual([]);
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    const asked = stepUpOptionsRequestSchema.parse(stepUp.issued[0]?.body);
    expect(asked).toEqual({
      purpose: 'customer_ai_permission',
      companyId: ARMADX.companyId,
      subjectId: asked.subjectId,
      details: {
        action: 'create',
        name: 'Delta',
        aiAllowed: true,
        automatedProcessingAllowed: false,
      },
    });
    const confirm = within(step).getByRole('button', { name: 'Onayla ve oluştur' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    expect(await screen.findByRole('heading', { level: 2, name: 'Depo' })).toBeVisible();
    const body = sentBody(api.callsTo('POST /projects')[0]);
    // The passkey names the customer that is created: one id in the options and in the request.
    expect(body.customer).toEqual({
      kind: 'new',
      id: asked.subjectId,
      name: 'Delta',
      aiAllowed: true,
      automatedProcessingAllowed: false,
    });
    expect(body.stepUp).toEqual(signed(challengeId(1)));
    expect(api.callsTo('POST /projects')).toHaveLength(1);
  });

  it('new project: Geri returns to the form with its values; a cancelled passkey prompt sends nothing', async () => {
    const stepUp = stepUpIssuer();
    const api = creatingApi({ 'POST /step-up/options': stepUp.handler });
    vi.mocked(startAuthentication).mockReset().mockRejectedValue(cancelledByPerson());
    renderApp(LIST);
    let form = await openNew();
    await userEvent.type(nameOf(form), 'Depo');
    await userEvent.selectOptions(customerOf(form), 'new');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Müşteri adı' }), 'Delta');
    await userEvent.click(
      within(form).getByRole('switch', { name: 'Sözleşme yapay zekâ kullanımına izin veriyor' }),
    );
    await userEvent.click(within(form).getByRole('radio', { name: 'Mor' }));
    await userEvent.click(create(form));
    const step = await screen.findByRole('dialog', {
      name: 'Müşterinin yapay zekâ izni açılsın mı?',
    });
    const confirm = within(step).getByRole('button', { name: 'Onayla ve oluştur' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    // The person closed the passkey prompt: said quietly, and nothing reached the API.
    expect(await within(step).findByText('Doğrulama iptal edildi.')).toBeVisible();
    expect(api.callsTo('POST /projects')).toEqual([]);

    await userEvent.click(within(step).getByRole('button', { name: 'Geri' }));
    form = await screen.findByRole('dialog', { name: 'Yeni proje' });
    expect(nameOf(form)).toHaveValue('Depo');
    expect(customerOf(form)).toHaveValue('new');
    expect(within(form).getByRole('textbox', { name: 'Müşteri adı' })).toHaveValue('Delta');
    expect(
      within(form).getByRole('switch', { name: 'Sözleşme yapay zekâ kullanımına izin veriyor' }),
    ).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'Mor' })).toBeChecked();
    await waitFor(() => {
      expect(create(form)).toHaveFocus();
    });
    expect(api.callsTo('POST /projects')).toEqual([]);
  });

  it("new project: the API's customer_exists sentence shows under the customer name, which takes the focus", async () => {
    const api = creatingApi({
      'POST /projects': () => apiError(409, 'customer_exists', exists),
    });
    renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.selectOptions(customerOf(dialog), 'new');
    const customerName = within(dialog).getByRole('textbox', { name: 'Müşteri adı' });
    expect(customerName).toHaveAttribute('aria-required', 'true');
    await userEvent.type(customerName, 'BETA LOJİSTİK');
    await userEvent.click(create(dialog));
    const alerts = await within(dialog).findAllByRole('alert');
    // Under its field, and nowhere else: not also above the footer.
    expect(alerts.map((alert) => alert.textContent)).toEqual([exists]);
    expect(customerName).toHaveAttribute('aria-invalid', 'true');
    expect(customerName).toHaveAccessibleDescription(exists);
    await waitFor(() => {
      expect(customerName).toHaveFocus();
    });
    // The form stays as it was, and the list of customers is read again for the person to choose.
    expect(nameOf(dialog)).toHaveValue('Depo');
    await waitFor(() => {
      expect(api.callsTo('GET /customers')).toHaveLength(2);
    });
  });

  it('new project: a name that exists, found after the passkey, brings the form back with the sentence under the name', async () => {
    const stepUp = stepUpIssuer();
    const api = creatingApi({
      'POST /step-up/options': stepUp.handler,
      'POST /projects': () => apiError(409, 'customer_exists', exists),
    });
    renderApp(LIST);
    const form = await openNew();
    await userEvent.type(nameOf(form), 'Depo');
    await userEvent.selectOptions(customerOf(form), 'new');
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'Müşteri adı' }),
      'Beta Lojistik',
    );
    await userEvent.click(
      within(form).getByRole('switch', { name: 'Sözleşme yapay zekâ kullanımına izin veriyor' }),
    );
    await userEvent.click(create(form));
    const step = await screen.findByRole('dialog', {
      name: 'Müşterinin yapay zekâ izni açılsın mı?',
    });
    const confirm = within(step).getByRole('button', { name: 'Onayla ve oluştur' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    const back = await screen.findByRole('dialog', { name: 'Yeni proje' });
    const customerName = within(back).getByRole('textbox', { name: 'Müşteri adı' });
    await waitFor(() => {
      expect(customerName).toHaveAccessibleDescription(exists);
    });
    await waitFor(() => {
      expect(customerName).toHaveFocus();
    });
    expect(customerName).toHaveValue('Beta Lojistik');
    // No new passkey prompt was prepared behind the form.
    expect(api.callsTo('POST /projects')).toHaveLength(1);
    expect(stepUp.issued).toHaveLength(1);
  });

  it('new project: there is no AI permission control, and the dialog says who opens it and how', async () => {
    const api = creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    expect(
      within(dialog).getByText(
        'Yapay zekâ izni kapalı başlar; izin açılana kadar bu projede ajanlar çalışamaz. İzni kurucu, proje sayfasından passkey ile açar.',
      ),
    ).toBeVisible();
    // Not for the founder either: without a new customer the dialog has no switch at all.
    expect(within(dialog).queryByRole('switch')).toBeNull();
    await userEvent.selectOptions(customerOf(dialog), 'new');
    // With a new customer the founder has the two contract switches, and nothing for the project.
    expect(
      within(dialog)
        .getAllByRole('switch')
        .map((control) => control.getAttribute('aria-label') ?? control.id).length,
    ).toBe(2);
    expect(within(dialog).queryByRole('switch', { name: /Yapay zekâ izni/ })).toBeNull();
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Müşteri adı' }), 'Delta');
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /projects')).toHaveLength(1);
    });
    // The body has no field for the project's AI permission.
    expect(Object.keys(api.callsTo('POST /projects')[0]?.body as object)).not.toContain(
      'aiAllowed',
    );
  });

  it('new project: colour and icon are radio groups the arrow keys move in, and the choice is named', async () => {
    creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    const colours = within(dialog).getByRole('radiogroup', { name: 'Renk' });
    const icons = within(dialog).getByRole('radiogroup', { name: 'Simge' });
    expect(within(colours).getAllByRole('radio')).toHaveLength(8);
    expect(within(icons).getAllByRole('radio')).toHaveLength(12);
    expect(within(colours).getByText('Seçili: Gri')).toHaveAttribute('aria-hidden', 'true');
    expect(within(icons).getByText('Seçili: Klasör')).toBeVisible();

    // The arrow keys move inside a group and choose; Tab leaves it.
    within(colours).getByRole('radio', { name: 'Gri' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(colours).getByRole('radio', { name: 'Kırmızı' })).toBeChecked();
    expect(within(colours).getByRole('radio', { name: 'Kırmızı' })).toHaveFocus();
    expect(within(colours).getByText('Seçili: Kırmızı')).toBeVisible();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    // Around the end of the group.
    expect(within(colours).getByRole('radio', { name: 'Pembe' })).toBeChecked();
    await userEvent.tab();
    expect(within(icons).getByRole('radio', { name: 'Klasör' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(icons).getByRole('radio', { name: 'Kod' })).toBeChecked();
    expect(within(icons).getByText('Seçili: Kod')).toBeVisible();

    // The chosen mark carries a sign, not only a colour; the ring is drawn on the mark.
    const chosen = within(colours).getByRole('radio', { name: 'Pembe' }).nextElementSibling;
    expect(chosen).toHaveClass('bg-project-pink', 'peer-focus-visible:outline-2');
    expect(chosen?.querySelector('svg')).toBeInTheDocument();
    const other = within(colours).getByRole('radio', { name: 'Gri' }).nextElementSibling;
    expect(other?.querySelector('svg')).toBeNull();
    expect(within(icons).getByRole('radio', { name: 'Kod' }).nextElementSibling).toHaveClass(
      'border-brand',
      'bg-row-hover',
    );
    expect(within(icons).getByRole('radio', { name: 'Klasör' }).nextElementSibling).toHaveClass(
      'border-line',
    );
  });

  it("new project: every colour and every icon has its Turkish name as the radio's name and as the title of its mark", async () => {
    creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    const named = (group: string) =>
      within(within(dialog).getByRole('radiogroup', { name: group }))
        .getAllByRole('radio')
        .map((radio) => [radio.getAttribute('aria-label'), radio.closest('label')?.title]);
    expect(named('Renk')).toEqual(
      PROJECT_COLORS.map((color) => [COLOR_NAME[color], COLOR_NAME[color]]),
    );
    expect(named('Simge')).toEqual(PROJECT_ICONS.map((icon) => [ICON_NAME[icon], ICON_NAME[icon]]));
    // A swatch keeps its fill when the system replaces colours.
    for (const radio of within(
      within(dialog).getByRole('radiogroup', { name: 'Renk' }),
    ).getAllByRole('radio')) {
      expect(radio.nextElementSibling).toHaveClass('forced-color-adjust-none');
    }
  });

  it('new project: Vazgeç gives the focus back to the button; a press outside does not close it', async () => {
    const api = creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), 'Depo');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) throw new Error('The dialog has no overlay');
    await userEvent.click(overlay);
    expect(screen.getByRole('dialog', { name: 'Yeni proje' })).toBeVisible();
    expect(nameOf(dialog)).toHaveValue('Depo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Yeni proje' })).toHaveFocus();
    });
    expect(api.callsTo('POST /projects')).toEqual([]);
    // Every opening starts empty.
    expect(nameOf(await openNew())).toHaveValue('');
  });

  it('new project: a people list that fails still lets the project be opened', async () => {
    const api = creatingApi({
      'GET /projects/member-candidates': () => apiError(409, 'invalid_request', 'Okunamadı.'),
      'GET /customers': () => apiError(409, 'invalid_request', 'Okunamadı.'),
    });
    renderApp(LIST);
    const dialog = await openNew();
    const members = within(dialog).getByRole('group', { name: 'Üyeler' });
    expect(
      await within(members).findByText(
        'Kişi listesi alınamadı. Üyeleri sonra proje sayfasından ekleyebilirsiniz.',
      ),
    ).toBeVisible();
    // The opener's own row is there all the same.
    expect(within(members).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(members).getByRole('checkbox', { name: 'Ömer Kadıoğlu (siz)' })).toBeChecked();
    // A customer list that fails leaves "no customer" and "a new one" to choose from.
    expect(
      await within(dialog).findByText(
        'Müşteri listesi alınamadı. Müşteriyi sonra proje sayfasından seçebilirsiniz.',
      ),
    ).toBeVisible();
    expect(
      within(customerOf(dialog))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Müşteri yok', 'Yeni müşteri ekle']);
    await userEvent.type(nameOf(dialog), 'Depo');
    api.handle('GET /projects/member-candidates', () => json({ people: CANDIDATES }));
    await userEvent.click(create(dialog));
    expect(await screen.findByRole('heading', { level: 2, name: 'Depo' })).toBeVisible();
    expect(sentBody(api.callsTo('POST /projects')[0]).memberIds).toEqual([]);
  });

  it('new project: a second press while the request is on its way sends nothing more', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = creatingApi({
      'POST /projects': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.click(create(dialog));
    const busy = await within(dialog).findByRole('button', { name: 'Oluşturuluyor' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(busy);
    await userEvent.keyboard('{Enter}');
    // It cannot be closed while the request is on its way.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Yeni proje' })).toBeVisible();
    expect(api.callsTo('POST /projects')).toHaveLength(1);

    // A refusal that belongs to no field shows above the footer; the form stays as it was.
    answer(apiError(409, 'private_space', 'Kurucu alanında proje açılamaz. Bir şirket seçin.'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Kurucu alanında proje açılamaz. Bir şirket seçin.',
    );
    expect(nameOf(dialog)).toHaveValue('Depo');
    // A send that is repeated carries the same id: the API answers the first project.
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /projects')).toHaveLength(2);
    });
    const [first, second] = api.callsTo('POST /projects').map((call) => sentBody(call).id);
    expect(second).toBe(first);
  });

  it('new project: an existing customer is chosen from the list and its id is sent; the founder reads its two contract permissions under the field, an employee reads none', async () => {
    const api = creatingApi();
    renderApp(LIST);
    let dialog = await openNew();
    await waitFor(() => {
      expect(within(customerOf(dialog)).getAllByRole('option')).toHaveLength(4);
    });
    expect(
      within(customerOf(dialog))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Müşteri yok', 'Beta Lojistik', 'Gama Enerji', 'Yeni müşteri ekle']);
    expect(customerOf(dialog)).toHaveAccessibleDescription('İsteğe bağlı.');
    await userEvent.selectOptions(customerOf(dialog), OTHER_CUSTOMER_ID);
    expect(
      within(dialog).getByText(
        'Sözleşme izinleri: yapay zekâ kullanımı açık, kodla otomatik işleme kapalı. İzinleri proje sayfasından değiştirebilirsiniz.',
      ),
    ).toBeVisible();
    await userEvent.selectOptions(customerOf(dialog), CUSTOMER_ID);
    expect(
      within(dialog).getByText(
        'Sözleşme izinleri: yapay zekâ kullanımı kapalı, kodla otomatik işleme kapalı. İzinleri proje sayfasından değiştirebilirsiniz.',
      ),
    ).toBeVisible();
    // An existing customer's permissions are not marked here.
    expect(within(dialog).queryByRole('switch')).toBeNull();
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /projects')).toHaveLength(1);
    });
    expect(sentBody(api.callsTo('POST /projects')[0]).customer).toEqual({
      kind: 'existing',
      customerId: CUSTOMER_ID,
    });
    cleanup();

    creatingApi({
      'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      'GET /customers': () => json({ customers: CUSTOMER_NAMES }),
    });
    renderApp(LIST);
    dialog = await openNew();
    await waitFor(() => {
      expect(within(customerOf(dialog)).getAllByRole('option')).toHaveLength(4);
    });
    await userEvent.selectOptions(customerOf(dialog), CUSTOMER_ID);
    expect(within(dialog).queryByText(/Sözleşme izinleri/)).toBeNull();
  });

  it('new project: choosing Yeni müşteri ekle leaves the focus on the select; the name field is the next Tab stop and the help text says to write the name', async () => {
    creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    const select = customerOf(dialog);
    await userEvent.selectOptions(select, 'new');
    // A change of a setting does not move the person (WCAG 3.2.2).
    expect(select).toHaveFocus();
    expect(select).toHaveAccessibleDescription('İsteğe bağlı. Müşteri adını aşağıya yazın.');
    await userEvent.tab();
    expect(within(dialog).getByRole('textbox', { name: 'Müşteri adı' })).toHaveFocus();
    // Back to "no customer": the name field goes away and is not asked for.
    await userEvent.selectOptions(select, '');
    expect(within(dialog).queryByRole('textbox', { name: 'Müşteri adı' })).toBeNull();
    expect(select).toHaveAccessibleDescription('İsteğe bağlı.');
  });

  it('new project: the founder marks only automated processing for a new customer and the project is created without a passkey step', async () => {
    const api = creatingApi();
    renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), 'Depo');
    await userEvent.selectOptions(customerOf(dialog), 'new');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Müşteri adı' }), 'Delta');
    await userEvent.click(
      within(dialog).getByRole('switch', { name: 'Sözleşme kodla otomatik işlemeye izin veriyor' }),
    );
    await userEvent.click(create(dialog));
    expect(await screen.findByRole('heading', { level: 2, name: 'Depo' })).toBeVisible();
    const body = sentBody(api.callsTo('POST /projects')[0]);
    expect(body.customer).toMatchObject({
      kind: 'new',
      name: 'Delta',
      aiAllowed: false,
      automatedProcessingAllowed: true,
    });
    expect(body.stepUp).toBeUndefined();
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('new project: Escape on the passkey view goes back to the form; Escape on the form closes the dialog', async () => {
    const api = creatingApi({ 'POST /step-up/options': stepUpIssuer().handler });
    renderApp(LIST);
    const form = await openNew();
    await userEvent.type(nameOf(form), 'Depo');
    await userEvent.selectOptions(customerOf(form), 'new');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Müşteri adı' }), 'Delta');
    await userEvent.click(
      within(form).getByRole('switch', { name: 'Sözleşme yapay zekâ kullanımına izin veriyor' }),
    );
    await userEvent.click(create(form));
    await screen.findByRole('dialog', { name: 'Müşterinin yapay zekâ izni açılsın mı?' });
    await userEvent.keyboard('{Escape}');
    // The filled form is not lost by the key a person presses to back out of a passkey prompt.
    const back = await screen.findByRole('dialog', { name: 'Yeni proje' });
    expect(nameOf(back)).toHaveValue('Depo');
    await waitFor(() => {
      expect(create(back)).toHaveFocus();
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST /projects')).toEqual([]);
  });

  it('new project: a founder without a passkey is told that the Güvenlik link leaves the form', async () => {
    creatingApi({
      'POST /step-up/options': () =>
        apiError(409, 'no_passkey', 'Bu işlem için kayıtlı bir passkey gerekiyor.'),
    });
    renderApp(LIST);
    const form = await openNew();
    await userEvent.type(nameOf(form), 'Depo');
    await userEvent.selectOptions(customerOf(form), 'new');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Müşteri adı' }), 'Delta');
    await userEvent.click(
      within(form).getByRole('switch', { name: 'Sözleşme yapay zekâ kullanımına izin veriyor' }),
    );
    await userEvent.click(create(form));
    const step = await screen.findByRole('dialog', {
      name: 'Müşterinin yapay zekâ izni açılsın mı?',
    });
    expect(await within(step).findByRole('link', { name: 'Güvenlik sayfasını aç' })).toBeVisible();
    expect(
      within(step).getByText(
        'Güvenlik sayfasına giderseniz bu form kapanır. Geri ile dönüp izni kapalı bırakarak projeyi şimdi oluşturabilirsiniz.',
      ),
    ).toBeVisible();
  });

  it('new project: after customer_not_found and member_not_allowed the lists are fetched again', async () => {
    const notFound = 'Seçilen müşteri bulunamadı. Müşteriyi listeden yeniden seçin.';
    const notAllowed =
      'Seçilen kişi projeye üye olamaz: projeye yalnızca şirketin kurucusu ve çalışanları üye olur. Kişiyi listeden yeniden seçin.';
    const api = creatingApi({
      'POST /projects': () => apiError(409, 'customer_not_found', notFound),
    });
    renderApp(LIST);
    const dialog = await openNew();
    await userEvent.type(nameOf(dialog), 'Depo');
    await waitFor(() => {
      expect(within(customerOf(dialog)).getAllByRole('option')).toHaveLength(4);
    });
    await userEvent.selectOptions(customerOf(dialog), OTHER_CUSTOMER_ID);
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Çağan Ünal' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Ayşe Yılmaz' }));

    // The customer was... gone from the company's list meanwhile.
    api.handle('GET /customers', () =>
      json({ customers: CUSTOMERS.filter((customer) => customer.id !== OTHER_CUSTOMER_ID) }),
    );
    await userEvent.click(create(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(notFound);
    // The person cannot refresh a list inside a dialog: the panel read it again and took the
    // choice that is gone back to "no customer".
    await waitFor(() => {
      expect(api.callsTo('GET /customers')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(customerOf(dialog)).toHaveValue('');
    });
    expect(within(customerOf(dialog)).queryByRole('option', { name: 'Gama Enerji' })).toBeNull();

    // A chosen person became an external person meanwhile.
    api.handle('POST /projects', () => apiError(409, 'member_not_allowed', notAllowed));
    api.handle('GET /projects/member-candidates', () =>
      json({ people: CANDIDATES.filter((person) => person.userId !== CAGAN.userId) }),
    );
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(notAllowed);
    });
    await waitFor(() => {
      expect(api.callsTo('GET /projects/member-candidates')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(within(dialog).queryByRole('checkbox', { name: 'Çağan Ünal' })).toBeNull();
    });
    // The people who are still offered stay checked; the one who is gone is not sent again.
    expect(within(dialog).getByRole('checkbox', { name: 'Ayşe Yılmaz' })).toBeChecked();
    const created = projectDetail({ id: NEW_ID, name: 'Depo' });
    api.handle('POST /projects', () => json(created, 201));
    api.handle(`GET /projects/${NEW_ID}`, () => json(created));
    await userEvent.click(create(dialog));
    await waitFor(() => {
      expect(api.callsTo('POST /projects')).toHaveLength(3);
    });
    const last = sentBody(api.callsTo('POST /projects')[2]);
    expect(last.memberIds).toEqual([AYSE.userId]);
    expect(last.customer).toEqual({ kind: 'none' });
  });
});

describe('project tile', () => {
  it('ProjectTile: a fill and an icon for every colour and icon of the contract, hidden from screen readers', () => {
    // A colour or an icon the contract gains must get its fill, its pictogram and its name here.
    expect(PROJECT_FILL).toEqual(
      Object.fromEntries(PROJECT_COLORS.map((color) => [color, `bg-project-${color}`])),
    );
    expect(Object.keys(COLOR_NAME)).toEqual([...PROJECT_COLORS]);
    expect(Object.keys(PROJECT_ICON)).toEqual([...PROJECT_ICONS]);
    expect(Object.keys(ICON_NAME)).toEqual([...PROJECT_ICONS]);
    // Twelve different pictograms: two icons never look the same.
    expect(new Set(Object.values(PROJECT_ICON)).size).toBe(PROJECT_ICONS.length);

    for (const color of PROJECT_COLORS) {
      const { container, unmount } = render(<ProjectTile color={color} icon="folder" />);
      const tile = container.querySelector('span');
      expect(tile).toHaveClass(`bg-project-${color}`, 'text-surface', 'size-6');
      expect(tile).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
    for (const icon of PROJECT_ICONS) {
      const { container, unmount } = render(<ProjectTile color="gray" icon={icon} size="md" />);
      const tile = container.querySelector('span');
      expect(tile).toHaveClass('size-8');
      const glyph = container.querySelector('svg');
      expect(glyph).toHaveClass('size-4');
      expect(glyph?.getAttribute('class')).toContain(
        `lucide-${(PROJECT_ICON[icon].displayName ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`,
      );
      unmount();
    }
  });
});
