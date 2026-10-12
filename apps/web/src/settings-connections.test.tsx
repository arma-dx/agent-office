import {
  COMPANY_HEADER,
  githubConnectionDetails,
  stepUpOptionsRequestSchema,
  type GithubConnection,
} from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { focusManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_PROBLEM, CONNECTION_UNAVAILABLE } from './lib/github/labels.ts';
import {
  ARMA_INSTALLATION,
  ARMA_ORG,
  CONNECT,
  connection,
  CONNECTION,
  DISCONNECT,
  INSTALL_URL,
  MANAGE_URL,
  PILLIKA_INSTALLATION,
  PILLIKA_ORG,
  pillikaConnection,
  REFRESH_REPOSITORIES,
  repositories,
  REPOSITORIES_UNAVAILABLE,
} from './test/github-fixtures.ts';
import {
  apiError,
  ARMADX,
  json,
  mockApi,
  PILLIKA,
  sessionHandler,
  type Handler,
} from './test/mock-api.ts';
import { ASSERTION, challengeId, signed, stepUpIssuer } from './test/passkeys.ts';
import { EMPLOYEE_AT_ARMADX, EXTERNAL_AT_ARMADX, sessionAs } from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// Ayarlar > Bağlantılar (8 October 2026, decisions 19 and 22; 12 October decisions 12 to 15): the
// founder connects the GitHub organisation of one company, with a passkey, and switches the
// connection off. The API of these tests is a fake; nothing here reaches GitHub.

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

const PAGE = '/c/armadx/settings/connections';
const PILLIKA_PAGE = '/c/pillika/settings/connections';

function founderApi(state: GithubConnection, extra: Record<string, Handler> = {}) {
  return mockApi({
    'GET /session': sessionHandler(),
    [CONNECTION]: () => json(state),
    ...extra,
  });
}

const section = () => screen.findByRole('region', { name: 'GitHub' });
const heading = () => screen.getByRole('heading', { level: 2, name: 'GitHub' });

/** Every request the panel sent to a GitHub route of the API. */
const githubCalls = (api: ReturnType<typeof mockApi>) =>
  api.calls.filter((call) => call.path.startsWith('/github'));

describe('settings, connections: who gets the page', () => {
  it('is in the account menu of the founder under Kullanıcılar and opens the page', async () => {
    founderApi(connection.notConfigured());
    const { router } = renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items.slice(0, 3)).toEqual(['Kullanıcılar', 'Bağlantılar', 'Güvenlik']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Bağlantılar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bağlantılar' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe(PAGE);
    // The page says whose connections these are, and has one section.
    expect(
      screen.getByText(
        'Arma DX şirketinin dış bağlantıları. Her şirket kendi GitHub kuruluşuna bir kez bağlanır; bağlantı yalnızca okur.',
      ),
    ).toBeVisible();
    expect(await section()).toBeVisible();
    // Settings are in the account menu, not in the sidebar menu.
    const mainMenu = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(mainMenu).queryByRole('link', { name: 'Bağlantılar' })).toBeNull();
  });

  it('is not offered to an employee', async () => {
    mockApi({ 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    expect(
      within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'Bağlantılar' }),
    ).toBeNull();
  });

  it('is not offered in Kurucu alanı', async () => {
    founderApi(connection.notConfigured());
    renderApp('/c/founder_space');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    expect(
      within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'Bağlantılar' }),
    ).toBeNull();
  });

  it.each([
    ['an employee', EMPLOYEE_AT_ARMADX],
    ['an external person', EXTERNAL_AT_ARMADX],
  ])('answers %s who opens the address with the refusal and asks nothing', async (_who, member) => {
    const api = mockApi({ 'GET /session': sessionAs(member) });
    renderApp(PAGE);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bu işlem için yetkiniz yok. GitHub bağlantısını kurucu yönetir.',
    );
    expect(githubCalls(api)).toEqual([]);
    expect(screen.queryByRole('region', { name: 'GitHub' })).toBeNull();
  });

  it('says in Kurucu alanı that GitHub is connected to a company, and asks nothing', async () => {
    const api = founderApi(connection.connected());
    renderApp('/c/founder_space/settings/connections');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'GitHub bir şirkete bağlanır' }),
    ).toBeVisible();
    expect(screen.getByText('Şirket seçiciden bir şirket seçin.')).toBeVisible();
    expect(githubCalls(api)).toEqual([]);
  });
});

describe('settings, connections: the states before a connection', () => {
  it('not configured: says so with the company, and offers nothing', async () => {
    founderApi(connection.notConfigured());
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        "Bu ortamda Arma DX için GitHub uygulaması ayarlı değil. Önce GitHub'da Arma DX kuruluşunun içinde uygulama oluşturulmalı ve anahtarı sunucunun ayarlarına konmalı.",
      ),
    ).toBeVisible();
    expect(within(region).queryByRole('button')).toBeNull();
    expect(within(region).queryByRole('link')).toBeNull();
  });

  it.each(['github_down', 'key_refused', 'rate_limited'] as const)(
    'unavailable (%s): the sentence and a retry that reads again',
    async (reason) => {
      const api = founderApi(connection.unavailable(reason));
      renderApp(PAGE);
      const region = await section();
      expect(await within(region).findByRole('alert')).toHaveTextContent(
        CONNECTION_UNAVAILABLE[reason],
      );
      api.handle(CONNECTION, () => json(connection.installed()));
      await userEvent.click(within(region).getByRole('button', { name: 'Yeniden dene' }));
      expect(await within(region).findByRole('button', { name: "GitHub'ı bağla" })).toBeVisible();
    },
  );

  it('not installed: the link to GitHub opens in the same tab and carries a state the tab keeps when it is pressed', async () => {
    founderApi(connection.notInstalled());
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        "GitHub uygulaması arma-org kuruluşuna henüz kurulmamış. Kurarken 'All repositories' (bütün depolar) seçin.",
      ),
    ).toBeVisible();
    expect(
      within(region).getByText(
        'Kurulumu bitirdiyseniz ve bu sayfa değişmediyse sayfayı yenileyin.',
      ),
    ).toBeVisible();
    const link = within(region).getByRole('link', { name: "GitHub'da kur" });
    const href = new URL(link.getAttribute('href') ?? '');
    expect(`${href.origin}${href.pathname}`).toBe(INSTALL_URL);
    const state = href.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Session storage belongs to the tab: the link must not open another one.
    expect(link).not.toHaveAttribute('target');
    // Nothing is kept before the founder presses the link.
    expect(sessionStorage.getItem('github-install')).toBeNull();
    // jsdom does not leave the page; the press is all the test needs.
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await userEvent.click(link);
    const kept = JSON.parse(sessionStorage.getItem('github-install') ?? 'null') as {
      state: string;
      company: string;
      at: number;
    };
    expect(kept.state).toBe(state);
    expect(kept.company).toBe('armadx');
    expect(Math.abs(Date.now() - kept.at)).toBeLessThan(5000);
  });

  it('comes back from GitHub to a page that reads the state again', async () => {
    const api = founderApi(connection.notInstalled());
    renderApp(PAGE);
    const region = await section();
    await within(region).findByRole('link', { name: "GitHub'da kur" });
    // The founder installed the app in another window and returns to this one.
    api.handle(CONNECTION, () => json(connection.installed()));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    expect(await within(region).findByRole('button', { name: "GitHub'ı bağla" })).toBeVisible();
  });

  it('invalid, owner mismatch: names the expected and the actual organisation and offers no connect', async () => {
    founderApi(
      connection.invalid({ reason: 'owner_mismatch', actualOwner: PILLIKA_ORG, manageUrl: null }),
    );
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        'Sunucudaki GitHub ayarı Arma DX için arma-org kuruluşunu bekliyor, ama uygulama pillika-org kuruluşuna ait. Sunucudaki ayar denetlenmeli; bu düzelmeden bağlanılamaz.',
      ),
    ).toBeVisible();
    expect(within(region).queryByRole('button')).toBeNull();
    expect(within(region).queryByRole('link')).toBeNull();
  });

  it.each([
    [
      'suspended',
      "Uygulama GitHub'da durdurulmuş. GitHub'da yeniden açın, sonra bu sayfayı yenileyin.",
    ],
    [
      'write_permission',
      "Uygulamanın GitHub'daki izinleri beklenenden geniş. Panel yalnızca dört okuma izniyle bağlanır: Metadata, Contents, Pull requests, Issues; hepsi 'Read-only'. İzinleri düzeltin, sonra bu sayfayı yenileyin.",
    ],
    [
      'other_permission',
      "Uygulamanın GitHub'daki izinleri beklenenden geniş. Panel yalnızca dört okuma izniyle bağlanır: Metadata, Contents, Pull requests, Issues; hepsi 'Read-only'. İzinleri düzeltin, sonra bu sayfayı yenileyin.",
    ],
    [
      'owner_not_organization',
      "Uygulama GitHub'da bir kuruluşa değil, bir kişinin hesabına ait. Uygulama arma-org kuruluşunun içinde oluşturulmalı; bu düzelmeden bağlanılamaz.",
    ],
  ] as const)(
    'invalid, %s: the sentence and the link to GitHub in a new tab',
    async (reason, text) => {
      founderApi(connection.invalid({ reason }));
      renderApp(PAGE);
      const region = await section();
      expect(await within(region).findByText(text)).toBeVisible();
      const link = within(region).getByRole('link', { name: /^GitHub'da düzenle/ });
      expect(link).toHaveAttribute('href', MANAGE_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // A screen reader hears that the link leaves the panel.
      expect(link).toHaveAccessibleName("GitHub'da düzenle, yeni sekmede açılır");
      expect(within(region).queryByRole('button')).toBeNull();
    },
  );

  it('installed on all repositories: says so and what connecting leads to', async () => {
    founderApi(connection.installed());
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        'arma-org kuruluşuna kurulu. Uygulama bu kuruluştaki bütün depoları görüyor.',
      ),
    ).toBeVisible();
    expect(
      within(region).getByText(
        'Bağlandığında Arma DX şirketinde proje açan herkes bu depoların adını görür ve birini projesine ekleyebilir; proje üyeleri o deponun son değişikliklerini, açık değişiklik isteklerini ve iş kayıtlarını, yazanların GitHub kullanıcı adlarıyla görür. Bağlantı yalnızca okur.',
      ),
    ).toBeVisible();
    expect(within(region).getByRole('button', { name: "GitHub'ı bağla" })).toBeVisible();
    // Nothing about an earlier connection or a missing permission.
    expect(within(region).queryByText(/daha önce kesildi/)).toBeNull();
    expect(within(region).queryByText(/izinleri eksik/)).toBeNull();
  });

  it('installed on selected repositories: is accepted, and the page says which of the two it is', async () => {
    founderApi(connection.installed({ repositorySelection: 'selected' }));
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        "arma-org kuruluşuna kurulu. Uygulama bu kuruluşta yalnızca GitHub'da seçilen depoları görüyor. Bütün depoları görmesi için GitHub'da 'All repositories' seçin.",
      ),
    ).toBeVisible();
    expect(within(region).getByRole('button', { name: "GitHub'ı bağla" })).toBeVisible();
  });

  it('installed: says that a connection was switched off before, and names a missing permission', async () => {
    founderApi(connection.installed({ wasConnected: true, permissions: ['metadata', 'contents'] }));
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        'Bu şirketin bağlantısı daha önce kesildi. Yeniden bağladığınızda projelere bağlı depolar geri gelir.',
      ),
    ).toBeVisible();
    expect(
      within(region).getByText(
        "Uygulamada şu okuma izinleri eksik: Pull requests, Issues. Eksik iznin listesi GitHub sekmesinde okunamaz; izni GitHub'da uygulamanın ayarlarından 'Read-only' olarak ekleyin.",
      ),
    ).toBeVisible();
  });

  it('loading, then a refusal of the API with a retry that works', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = mockApi({
      'GET /session': sessionHandler(),
      [CONNECTION]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    renderApp(PAGE);
    const region = await section();
    await waitFor(() => {
      expect(api.callsTo(CONNECTION)).toHaveLength(1);
    });
    expect(within(region).getByRole('status')).toHaveTextContent('Yükleniyor');
    release(apiError(409, 'invalid_request', 'Bağlantı şu anda okunamadı. Yeniden deneyin.'));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Bağlantı şu anda okunamadı. Yeniden deneyin.',
    );
    api.handle(CONNECTION, () => json(connection.notConfigured()));
    await userEvent.click(within(region).getByRole('button', { name: 'Yeniden dene' }));
    expect(await within(region).findByText(/GitHub uygulaması ayarlı değil/)).toBeVisible();
  });
});

describe('settings, connections: connecting', () => {
  it('connects with a passkey for the organisation and the installation the page shows, in this company', async () => {
    const issuer = stepUpIssuer();
    const api = founderApi(connection.installed(), {
      'POST /step-up/options': issuer.handler,
      [CONNECT]: () => json(connection.connected()),
    });
    renderApp(PAGE);
    const region = await section();
    const connect = await within(region).findByRole('button', { name: "GitHub'ı bağla" });
    await userEvent.click(connect);
    const dialog = await screen.findByRole('alertdialog', { name: 'GitHub bağlansın mı?' });
    expect(dialog).toHaveTextContent(
      'arma-org kuruluşunu Arma DX şirketine bağlamayı passkey ile onaylayın.',
    );
    // The re-verification names this company as its subject and what the page showed.
    await waitFor(() => {
      expect(issuer.issued).toHaveLength(1);
    });
    expect(stepUpOptionsRequestSchema.parse(issuer.issued[0]?.body)).toEqual({
      purpose: 'github_connection',
      companyId: ARMADX.companyId,
      subjectId: ARMADX.companyId,
      details: githubConnectionDetails(ARMA_ORG, ARMA_INSTALLATION),
    });
    // Nothing is written before the founder confirms.
    expect(api.callsTo(CONNECT)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: "GitHub'ı bağla" }));

    expect(await within(region).findByText(/arma-org kuruluşuna bağlı\./)).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const [call] = api.callsTo(CONNECT);
    // The browser tells the API nothing about GitHub: the body is the signed answer alone.
    expect(call?.body).toEqual({ stepUp: signed(challengeId(1)) });
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(await screen.findByText('GitHub bağlandı.')).toBeVisible();
    // The button that was pressed is gone with its state: the heading takes the focus.
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
    expect(api.unexpected).toEqual([]);
  });

  it('Vazgeç sends nothing and gives the focus back to the button', async () => {
    const api = founderApi(connection.installed(), {
      'POST /step-up/options': stepUpIssuer().handler,
    });
    renderApp(PAGE);
    const region = await section();
    const connect = await within(region).findByRole('button', { name: "GitHub'ı bağla" });
    await userEvent.click(connect);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.callsTo(CONNECT)).toEqual([]);
    expect(connect).toHaveFocus();
  });

  it("shows the API's refusal in the dialog, keeps the state and reads the page again", async () => {
    const api = founderApi(connection.installed(), {
      'POST /step-up/options': stepUpIssuer().handler,
      [CONNECT]: () =>
        apiError(
          409,
          'github_organization_taken',
          'Bu GitHub kuruluşu başka bir şirkete bağlı. Her şirket kendi kuruluşuna bağlanır; sunucudaki ayar denetlenmeli.',
        ),
    });
    renderApp(PAGE);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: "GitHub'ı bağla" }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => {
      expect(api.callsTo('POST /step-up/options')).toHaveLength(1);
    });
    const before = api.callsTo(CONNECTION).length;
    await userEvent.click(within(dialog).getByRole('button', { name: "GitHub'ı bağla" }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bu GitHub kuruluşu başka bir şirkete bağlı. Her şirket kendi kuruluşuna bağlanır; sunucudaki ayar denetlenmeli.',
    );
    // Nothing reads as connected, and the state behind the dialog was asked for again.
    expect(within(region).queryByText(/kuruluşuna bağlı\./)).toBeNull();
    await waitFor(() => {
      expect(api.callsTo(CONNECTION).length).toBeGreaterThan(before);
    });
  });

  it('closes the confirmation when the installation behind it changed, and shows the new state', async () => {
    const api = founderApi(connection.installed(), {
      'POST /step-up/options': stepUpIssuer().handler,
      // The app was installed again meanwhile: what the founder would sign no longer exists.
      [CONNECT]: () => {
        api.handle(CONNECTION, () => json(connection.installed({ installationId: 5002 })));
        return apiError(403, 'step_up_failed', 'Doğrulama başarısız oldu.');
      },
    });
    renderApp(PAGE);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: "GitHub'ı bağla" }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => {
      expect(api.callsTo('POST /step-up/options')).toHaveLength(1);
    });
    await userEvent.click(within(dialog).getByRole('button', { name: "GitHub'ı bağla" }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    // The page offers to connect what is there now; a new press asks for the new installation.
    const issuedBefore = api.callsTo('POST /step-up/options').length;
    await userEvent.click(within(region).getByRole('button', { name: "GitHub'ı bağla" }));
    await screen.findByRole('alertdialog');
    await waitFor(() => {
      expect(api.callsTo('POST /step-up/options').length).toBeGreaterThan(issuedBefore);
    });
    const last = api.callsTo('POST /step-up/options').at(-1);
    expect(stepUpOptionsRequestSchema.parse(last?.body).details).toEqual(
      githubConnectionDetails(ARMA_ORG, 5002),
    );
  });
});

describe('settings, connections: connected', () => {
  it('says to whom, by whom and when, what the app reaches and how many projects hang on it', async () => {
    founderApi(connection.connected());
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        (_text, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'arma-org kuruluşuna bağlı. Bağlayan: Ömer Kadıoğlu, 12 Ekim 2026.',
      ),
    ).toBeVisible();
    expect(
      within(region).getByText('Uygulama kuruluştaki bütün depoları görüyor: 3 depo.'),
    ).toBeVisible();
    expect(within(region).getByText('Deposu bağlı proje sayısı: 1.')).toBeVisible();
    expect(within(region).getByRole('button', { name: 'Listeyi yenile' })).toBeVisible();
    expect(within(region).getByRole('button', { name: 'Bağlantıyı kes' })).toBeVisible();
    const manage = within(region).getByRole('link', { name: /^GitHub'da depoları düzenle/ });
    expect(manage).toHaveAttribute('href', MANAGE_URL);
    expect(manage).toHaveAttribute('target', '_blank');
    expect(manage).toHaveAttribute('rel', 'noopener noreferrer');
    // No problem is named while there is none.
    expect(within(region).queryByText(/çalışmıyor/)).toBeNull();
  });

  it('says that the app sees selected repositories only, and names nobody when nobody connected', async () => {
    founderApi(
      connection.connected({
        repositorySelection: 'selected',
        repositoryCount: 1,
        connectedBy: null,
        linkedProjectCount: 0,
      }),
    );
    renderApp(PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        "Uygulama yalnızca GitHub'da seçilen depoları görüyor: 1 depo.",
      ),
    ).toBeVisible();
    expect(within(region).getByText(/Bağlandığı gün:/)).toHaveTextContent(
      'arma-org kuruluşuna bağlı. Bağlandığı gün: 12 Ekim 2026.',
    );
    expect(within(region).getByText('Deposu bağlı proje sayısı: 0.')).toBeVisible();
  });

  it.each(['installation_gone', 'suspended', 'key_refused'] as const)(
    'problem %s: names it, counts nothing and still offers to disconnect',
    async (problem) => {
      founderApi(
        connection.connected({
          problem,
          repositorySelection: null,
          repositoryCount: null,
          manageUrl: null,
        }),
      );
      renderApp(PAGE);
      const region = await section();
      expect(await within(region).findByText(CONNECTION_PROBLEM[problem])).toBeVisible();
      expect(within(region).queryByText(/depoları görüyor/)).toBeNull();
      // Reading the list again cannot help; switching the connection off always can.
      expect(within(region).queryByRole('button', { name: 'Listeyi yenile' })).toBeNull();
      expect(within(region).getByRole('button', { name: 'Bağlantıyı kes' })).toBeVisible();
      // The row is not changed by a read: the page still says the company is connected.
      expect(within(region).getByText(/arma-org kuruluşuna bağlı\./)).toBeVisible();
    },
  );

  it('Listeyi yenile makes the API read the list from GitHub again, then reads the count again', async () => {
    const api = founderApi(connection.connected(), {
      [REFRESH_REPOSITORIES]: () => {
        api.handle(CONNECTION, () => json(connection.connected({ repositoryCount: 4 })));
        return json(repositories());
      },
    });
    renderApp(PAGE);
    const region = await section();
    const refresh = await within(region).findByRole('button', { name: 'Listeyi yenile' });
    await userEvent.click(refresh);
    expect(
      await within(region).findByText('Uygulama kuruluştaki bütün depoları görüyor: 4 depo.'),
    ).toBeVisible();
    expect(api.callsTo(REFRESH_REPOSITORIES)).toHaveLength(1);
    expect(await screen.findByText('Depo listesi yeniden okundu.')).toBeVisible();
    // The button kept the focus.
    expect(within(region).getByRole('button', { name: 'Listeyi yenile' })).toHaveFocus();
  });

  it('Listeyi yenile says so when GitHub could not be asked', async () => {
    founderApi(connection.connected(), {
      [REFRESH_REPOSITORIES]: () => json(REPOSITORIES_UNAVAILABLE),
    });
    renderApp(PAGE);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Listeyi yenile' }));
    expect(
      await screen.findByText('Depo listesi okunamadı. Biraz sonra yeniden deneyin.'),
    ).toBeVisible();
  });

  it('disconnects after a plain confirmation: no passkey, Vazgeç first, and the page shows the new state', async () => {
    const api = founderApi(connection.connected(), {
      [DISCONNECT]: () => json(connection.installed({ wasConnected: true })),
    });
    renderApp(PAGE);
    const region = await section();
    const button = await within(region).findByRole('button', { name: 'Bağlantıyı kes' });
    await userEvent.click(button);
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Arma DX şirketinin GitHub bağlantısı kesilsin mi?',
    });
    expect(dialog).toHaveTextContent(
      "Projelerdeki GitHub sekmeleri boş kalır ve yeni projede depo seçilemez. Projelere bağlı depolar silinmez; yeniden bağladığınızda geri gelir. Uygulama GitHub'da kurulu kalır; tamamen kaldırmak için GitHub'da kuruluş ayarlarından kaldırın.",
    );
    // Giving up is the first thing the keyboard reaches, and changes nothing.
    expect(within(dialog).getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.callsTo(DISCONNECT)).toEqual([]);
    expect(button).toHaveFocus();

    await userEvent.click(button);
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bağlantıyı kes' }));
    expect(await within(region).findByRole('button', { name: "GitHub'ı bağla" })).toBeVisible();
    expect(within(region).getByText(/daha önce kesildi/)).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const [call] = api.callsTo(DISCONNECT);
    expect(call?.body).toBeUndefined();
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    // No passkey was asked for.
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(await screen.findByText('GitHub bağlantısı kesildi.')).toBeVisible();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it("shows the API's refusal of a disconnect in the dialog and stays connected", async () => {
    founderApi(connection.connected(), {
      [DISCONNECT]: () => apiError(403, 'founder_only', 'Bu işlemi yalnızca kurucu yapabilir.'),
    });
    renderApp(PAGE);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Bağlantıyı kes' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bağlantıyı kes' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bu işlemi yalnızca kurucu yapabilir.',
    );
    expect(within(region).getByText(/arma-org kuruluşuna bağlı\./)).toBeInTheDocument();
  });
});

describe('settings, connections: the two companies', () => {
  it("Pillika's page asks with Pillika's company and shows nothing of Arma DX", async () => {
    // The fake answers by the company of the request, as the API does.
    const byCompany: Handler = (call) =>
      json(
        call.headers.get(COMPANY_HEADER) === PILLIKA.companyId
          ? pillikaConnection.installed()
          : connection.connected(),
      );
    const issuer = stepUpIssuer();
    const api = mockApi({
      'GET /session': sessionHandler(),
      [CONNECTION]: byCompany,
      'POST /step-up/options': issuer.handler,
      [CONNECT]: () => json(pillikaConnection.connected()),
    });
    renderApp(PILLIKA_PAGE);
    const region = await section();
    expect(
      await within(region).findByText(
        'pillika-org kuruluşuna kurulu. Uygulama bu kuruluştaki bütün depoları görüyor.',
      ),
    ).toBeVisible();
    expect(screen.getByText(/^Pillika şirketinin dış bağlantıları\./)).toBeVisible();
    expect(screen.getByRole('main')).not.toHaveTextContent(ARMA_ORG);
    expect(screen.getByRole('main')).not.toHaveTextContent('Arma DX');
    for (const call of githubCalls(api)) {
      expect(call.headers.get(COMPANY_HEADER)).toBe(PILLIKA.companyId);
    }

    // The passkey of Pillika's connection is asked for Pillika and its own organisation.
    await userEvent.click(within(region).getByRole('button', { name: "GitHub'ı bağla" }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      'pillika-org kuruluşunu Pillika şirketine bağlamayı passkey ile onaylayın.',
    );
    await waitFor(() => {
      expect(issuer.issued).toHaveLength(1);
    });
    expect(stepUpOptionsRequestSchema.parse(issuer.issued[0]?.body)).toEqual({
      purpose: 'github_connection',
      companyId: PILLIKA.companyId,
      subjectId: PILLIKA.companyId,
      details: githubConnectionDetails(PILLIKA_ORG, PILLIKA_INSTALLATION),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: "GitHub'ı bağla" }));
    expect(await within(region).findByText(/pillika-org kuruluşuna bağlı\./)).toBeVisible();
    expect(api.callsTo(CONNECT)[0]?.headers.get(COMPANY_HEADER)).toBe(PILLIKA.companyId);
  });

  it('shows nothing of the company that was open before when the other one is selected', async () => {
    const byCompany: Handler = (call) =>
      json(
        call.headers.get(COMPANY_HEADER) === PILLIKA.companyId
          ? connection.notConfigured()
          : connection.connected(),
      );
    const api = mockApi({ 'GET /session': sessionHandler(), [CONNECTION]: byCompany });
    const { router } = renderApp(PAGE);
    const region = await section();
    await within(region).findByText(/arma-org kuruluşuna bağlı\./);
    await router.navigate({
      to: '/c/$company/settings/connections',
      params: { company: 'pillika' },
    });
    expect(
      await screen.findByText(/^Bu ortamda Pillika için GitHub uygulaması ayarlı değil\./),
    ).toBeVisible();
    expect(screen.getByRole('main')).not.toHaveTextContent(ARMA_ORG);
    expect(api.callsTo(CONNECTION).map((call) => call.headers.get(COMPANY_HEADER))).toEqual([
      ARMADX.companyId,
      PILLIKA.companyId,
    ]);
  });
});
