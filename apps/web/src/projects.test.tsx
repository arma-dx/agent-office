import { PROJECT_COLORS, PROJECT_ICONS } from '@agent-office/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProjectTile } from './components/projects/project-tile.tsx';
import { formatDay, formatFull } from './lib/dates.ts';
import { COLOR_NAME, ICON_NAME, PROJECT_FILL, PROJECT_ICON } from './lib/projects/labels.ts';
import { WIDE_WINDOW_QUERY } from './lib/office/use-wide-window.ts';
import { stubMatchMedia } from './test/match-media.ts';
import {
  apiError,
  FOUNDER_SPACE,
  json,
  mockApi,
  sessionHandler,
  type Handler,
} from './test/mock-api.ts';
import {
  AYSE,
  CUSTOMER_ID,
  EMPLOYEE_AT_ARMADX,
  EXTERNAL_AT_ARMADX,
  FOUNDER_MEMBER,
  project,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  sessionAs,
} from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

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

  it("page: lists the members by name with their role, the reader's own row marked", async () => {
    mockApi(
      projectHandlers(
        projectDetail({
          members: [
            FOUNDER_MEMBER,
            { ...AYSE, active: false },
            {
              userId: '55555555-5555-4555-8555-555555555555',
              name: null,
              role: null,
              active: false,
            },
          ],
        }),
      ),
    );
    renderApp(PAGE);
    const members = await screen.findByRole('region', { name: 'Üyeler 3' });
    expect(
      within(members)
        .getAllByRole('group')
        .map((row) => row.textContent),
    ).toEqual([
      'Ayşe YılmazÇalışan, devre dışı',
      'Ömer Kadıoğlu (siz)Kurucu',
      'Eski üyedevre dışı',
    ]);
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

  it('page: an employee reads the words of the permissions and who changes them', async () => {
    stubMatchMedia([WIDE_WINDOW_QUERY]);
    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PAGE);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const ai = within(panel()).getByRole('region', { name: 'Yapay zekâ izni' });
    expect(within(ai).getByText('İzin kapalı')).toBeVisible();
    expect(within(ai).getByText('İzni yalnızca kurucu değiştirir.')).toBeVisible();
    const contract = within(panel()).getByRole('region', { name: 'Müşterinin sözleşmesi' });
    expect(valueOf(contract, 'Yapay zekâ kullanımı')).toHaveTextContent('İzin yok');
    // The automated processing permission is not an employee's to read.
    expect(within(contract).queryByText('Kodla otomatik işleme')).toBeNull();
    expect(within(contract).getByText('İzinleri yalnızca kurucu değiştirir.')).toBeVisible();
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
