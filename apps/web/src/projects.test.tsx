import { PROJECT_COLORS, PROJECT_ICONS } from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTile } from './components/projects/project-tile.tsx';
import { formatDay, formatFull } from './lib/dates.ts';
import { COLOR_NAME, ICON_NAME, PROJECT_FILL, PROJECT_ICON } from './lib/projects/labels.ts';
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
  EMPLOYEE_AT_ARMADX,
  EXTERNAL_AT_ARMADX,
  FOUNDER_MEMBER,
  OTHER_CUSTOMER_ID,
  project,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  sessionAs,
} from './test/project-fixtures.ts';
import { ASSERTION, challengeId, signed, stepUpIssuer } from './test/passkeys.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
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

/** The properties panel of the shell; it shows by itself in a wide window. */
function panel() {
  return screen.getByRole('complementary', { name: 'Özellikler' });
}

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
    expect(within(row).getByText('Beta Lojistik')).toBeInTheDocument();
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

  it('list: says why and sends nothing for an external person and in Kurucu alanı', async () => {
    const external = mockApi({ 'GET /session': sessionAs(EXTERNAL_AT_ARMADX) });
    const first = renderApp(LIST);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Projeler dış kişilere açık değil' }),
    ).toBeVisible();
    expect(screen.getByText('Projeleri şirketin kurucusu ve çalışanları görür.')).toBeVisible();
    expect(external.callsTo('GET /projects')).toEqual([]);
    expect(external.unexpected).toEqual([]);
    first.queryClient.clear();
    document.body.innerHTML = '';

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
    expect(within(bar).getByText('Projeler')).toBeVisible();
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
    const first = renderApp(PAGE);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Projeler dış kişilere açık değil' }),
    ).toBeVisible();
    expect(external.callsTo(`GET /projects/${PROJECT_ID}`)).toEqual([]);
    expect(external.unexpected).toEqual([]);
    first.queryClient.clear();
    document.body.innerHTML = '';

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
        { ...AYSE, active: false },
        { userId: '55555555-5555-4555-8555-555555555555', name: null, role: null, active: false },
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
      'Ayşe YılmazÇalışan, devre dışı',
      'Ömer Kadıoğlu (siz)Kurucu',
      'Eski üyedevre dışı',
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
    expect(within(row('Çağan Ünal')).getByText('Çalışan')).toBeVisible();
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

  it('members: an employee has no button on their own row; the founder has one', async () => {
    mockApi(
      projectHandlers(projectForEmployee({ members: [ME, AYSE] }), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      }),
    );
    const first = renderApp(PAGE);
    await screen.findByRole('region', { name: 'Üyeler 2' });
    expect(within(row('Ömer Kadıoğlu (siz)')).queryByRole('button')).toBeNull();
    expect(
      within(row('Ayşe Yılmaz')).getByRole('button', { name: 'Projeden çıkar' }),
    ).toBeVisible();
    first.queryClient.clear();
    document.body.innerHTML = '';

    // The founder may take themselves off: they see every project anyway, and the dialog says so.
    mockApi(projectHandlers());
    renderApp(PAGE);
    await screen.findByRole('region', { name: 'Üyeler 2' });
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
    const first = renderApp(PAGE);
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
    first.queryClient.clear();
    document.body.innerHTML = '';

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
    const first = renderApp(PAGE);
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
    first.queryClient.clear();
    document.body.innerHTML = '';

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
    const first = renderApp(PAGE);
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
    first.queryClient.clear();
    document.body.innerHTML = '';

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
