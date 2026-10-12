import { BACKGROUND_HEADER, COMPANY_HEADER, type ProjectGithub } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GITHUB_TAB_REFRESH_MS } from './components/projects/project-github.tsx';
import { formatClock } from './lib/dates.ts';
import { tabUnavailableText } from './lib/github/labels.ts';
import {
  ARMA_ORG,
  ARMA_REPOSITORIES,
  COMMITS,
  ISSUES,
  LINKED,
  lists,
  NO_REPOSITORIES,
  projectGithubRoute,
  PULL_REQUESTS,
  removeRepositoryRoute,
  repositories,
  REPOSITORIES,
  REPOSITORIES_UNAVAILABLE,
  setRepositoryRoute,
  STORED,
  tab,
} from './test/github-fixtures.ts';
import { apiError, ARMADX, json, mockApi, type Handler } from './test/mock-api.ts';
import {
  EMPLOYEE_AT_ARMADX,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  sessionAs,
} from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The "GitHub" tab of a project (8 October 2026, decision 17; 12 October decisions 14 to 17) and
// the dialog that gives the project its repository. The API of these tests is a fake: nothing
// here reaches GitHub.

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const TAB = `${PATH}?tab=github`;
const GITHUB = projectGithubRoute();
const SET = setRepositoryRoute();
const REMOVE = removeRepositoryRoute();

function api(answer: ProjectGithub, extra: Record<string, Handler> = {}) {
  return mockApi(projectHandlers(projectDetail(), { [GITHUB]: () => json(answer), ...extra }));
}

const panel = () => screen.findByRole('tabpanel', { name: 'GitHub' });
const section = () => screen.findByRole('region', { name: 'GitHub' });
const heading = () => screen.getByRole('heading', { level: 3, name: 'GitHub' });
const listOf = (name: string) => screen.getByRole('list', { name });
const rowsOf = (name: string) => within(listOf(name)).getAllByRole('listitem');
const button = (region: HTMLElement, name: string) =>
  within(region).queryByRole('button', { name });

describe('the GitHub tab: where it is', () => {
  it('stands after Dosyalar, opens from the address and asks nothing before it is opened', async () => {
    const fake = api(tab.ok());
    const { router } = renderApp(PATH);
    const trigger = await screen.findByRole('tab', { name: 'GitHub' });
    // The base tabs in the order decision 17 names them.
    expect(
      screen
        .getAllByRole('tab')
        .map((item) => item.textContent)
        .slice(0, 3),
    ).toEqual(['Talepler', 'Dosyalar', 'GitHub']);
    await screen.findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(fake.callsTo(GITHUB)).toHaveLength(0);
    await userEvent.click(trigger);
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'github' } });
    });
    expect(await section()).toBeVisible();
    await waitFor(() => {
      expect(fake.callsTo(GITHUB)).toHaveLength(1);
    });
    // Asked for the selected company, as a request of the person.
    const [call] = fake.callsTo(GITHUB);
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(call?.headers.has(BACKGROUND_HEADER)).toBe(false);
    cleanup();

    // The address alone opens the tab, as after a reload.
    api(tab.ok());
    renderApp(TAB);
    expect(await screen.findByRole('tab', { name: 'GitHub' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await section()).toBeVisible();
  });
});

describe('the GitHub tab: the three lists', () => {
  it('names the repository with its link and when it was read', async () => {
    api(tab.ok());
    renderApp(TAB);
    const region = await section();
    const repository = await within(region).findByRole('link', {
      name: `${ARMA_ORG}/depo-otomasyonu, yeni sekmede açılır`,
    });
    expect(repository).toHaveAttribute('href', LINKED.url);
    expect(region).toHaveTextContent(`Son okuma: ${formatClock(lists().fetchedAt)}`);
    // Not archived: nothing says so.
    expect(region).not.toHaveTextContent('arşivlenmiş');
  });

  it('says that the repository is archived when GitHub says so', async () => {
    api(tab.ok({ lists: lists({ archived: true }) }));
    renderApp(TAB);
    const region = await section();
    // After the name (whose link also tells a screen reader that it opens a new tab).
    await waitFor(() => {
      expect(region).toHaveTextContent(
        `${ARMA_ORG}/depo-otomasyonu, yeni sekmede açılır (arşivlenmiş). Son okuma:`,
      );
    });
  });

  it('lists commits, pull requests and issues under sentence-case headings, each row with its facts in words', async () => {
    api(tab.ok());
    renderApp(TAB);
    const region = await section();
    await within(region).findByRole('heading', { level: 4, name: 'Son kod değişiklikleri' });
    expect(
      within(region)
        .getAllByRole('heading', { level: 4 })
        .map((item) => item.textContent),
    ).toEqual(['Son kod değişiklikleri', 'Açık değişiklik istekleri', 'Açık iş kayıtları']);

    const commits = rowsOf('Son kod değişiklikleri');
    expect(commits).toHaveLength(COMMITS.length);
    // The author is the GitHub user name (12 October decision 16), then the date and the number.
    expect(commits[0]).toHaveTextContent('Raf etiketlerinin okunmasını düzelt');
    expect(commits[0]).toHaveTextContent(/ayse-k yazdı, .+, aaaaaaa$/);
    // A commit that is tied to no GitHub account names nobody, and its title is no link.
    expect(commits[1]).toHaveTextContent(/^İlk sürüm.+, bbbbbbb$/);
    expect(commits[1]).not.toHaveTextContent('yazdı');
    expect(within(commits[1] as HTMLElement).queryByRole('link')).toBeNull();

    const pulls = rowsOf('Açık değişiklik istekleri');
    expect(pulls).toHaveLength(PULL_REQUESTS.length);
    expect(pulls[0]).toHaveTextContent(/^Sayım ekranı.*#42, mehmet açtı, .+, taslak$/);
    expect(pulls[1]).toHaveTextContent(/#40, ayse-k açtı, /);
    expect(pulls[1]).not.toHaveTextContent('taslak');

    const issues = rowsOf('Açık iş kayıtları');
    expect(issues).toHaveLength(ISSUES.length);
    expect(issues[0]).toHaveTextContent(/^Barkod okuyucu bağlantısı kopuyor.*#17, zeynep-d açtı, /);
    // Dates are times a screen reader and a pointer can read whole.
    expect(within(commits[0] as HTMLElement).getByText(/Eki|önce|dün|şimdi/)).toHaveAttribute(
      'datetime',
      COMMITS[0]?.date,
    );
    // No dotted separator between the facts.
    expect(region).not.toHaveTextContent('·');
  });

  it('opens every link to GitHub in a new tab that knows nothing of the panel, and loads nothing from GitHub', async () => {
    api(tab.ok());
    renderApp(TAB);
    const region = await section();
    await within(region).findByRole('heading', { level: 4, name: 'Açık iş kayıtları' });
    const links = within(region).getAllByRole('link');
    // The repository, one commit, two pull requests, one issue.
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\//);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(
      within(region).getByRole('link', { name: 'Sayım ekranı, yeni sekmede açılır' }),
    ).toHaveAttribute('href', PULL_REQUESTS[0]?.url);
    // Nothing of the page is fetched from GitHub: no picture, script, frame, style or media.
    expect(
      document.querySelectorAll(
        'img, script[src], iframe, link[href], video, audio, object, embed',
      ),
    ).toHaveLength(0);
    for (const element of document.querySelectorAll('[src], [srcset], [style]')) {
      for (const name of ['src', 'srcset', 'style']) {
        expect(element.getAttribute(name) ?? '').not.toMatch(/github|url\(/i);
      }
    }
  });

  it('shows what a person wrote on GitHub as plain text', async () => {
    const title = '<img src=x onerror=alert(1)> **kalın** [bağlantı](https://example.org)';
    api(
      tab.ok({
        lists: lists({
          issues: { items: [{ ...(ISSUES[0] as (typeof ISSUES)[0]), title }], more: false },
        }),
      }),
    );
    renderApp(TAB);
    await section();
    const [row] = await waitFor(() => rowsOf('Açık iş kayıtları'));
    expect(within(row as HTMLElement).getByText(title)).toBeVisible();
    expect((row as HTMLElement).querySelector('img, strong, b')).toBeNull();
    // The only link of the row is GitHub's own address of the issue.
    const links = within(row as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', ISSUES[0]?.url);
  });

  it('says of each list by itself that it is empty, that GitHub has more, or that it could not be read', async () => {
    api(
      tab.ok({
        lists: lists({
          commits: { items: COMMITS, more: true },
          pullRequests: null,
          issues: { items: [], more: false },
        }),
      }),
    );
    renderApp(TAB);
    const region = await section();
    await within(region).findByRole('heading', { level: 4, name: 'Açık iş kayıtları' });
    // One list failing does not take the others down.
    expect(rowsOf('Son kod değişiklikleri')).toHaveLength(COMMITS.length);
    const more = within(region).getByRole('link', { name: /^Daha fazlası GitHub'da\./ });
    expect(more).toHaveAttribute('href', LINKED.url);
    expect(within(region).getByText('Bu liste okunamadı.')).toBeVisible();
    expect(within(region).getByText('Açık iş kaydı yok.')).toBeVisible();
    cleanup();

    api(
      tab.ok({
        lists: lists({
          commits: { items: [], more: false },
          pullRequests: { items: [], more: false },
          issues: null,
        }),
      }),
    );
    renderApp(TAB);
    const empty = await section();
    expect(await within(empty).findByText('Bu depoda henüz kod değişikliği yok.')).toBeVisible();
    expect(within(empty).getByText('Açık değişiklik isteği yok.')).toBeVisible();
    expect(within(empty).getByText('Bu liste okunamadı.')).toBeVisible();
    expect(within(empty).queryByRole('list')).toBeNull();
  });
});

describe('the GitHub tab: what cannot be shown', () => {
  it('not connected: says who connects; the founder gets the way there, an employee does not', async () => {
    api(tab.notConnected());
    renderApp(TAB);
    let region = await section();
    expect(
      await within(region).findByText(
        "Şirketin GitHub'ı bağlı değil. Kurucu, Ayarlar > Bağlantılar'dan bağlar.",
      ),
    ).toBeVisible();
    expect(within(region).getByRole('link', { name: "Bağlantılar'ı aç" })).toHaveAttribute(
      'href',
      '/c/armadx/settings/connections',
    );
    expect(button(region, 'Depo bağla')).toBeNull();
    expect(button(region, 'Depoyu kaldır')).toBeNull();
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [GITHUB]: () => json(tab.notConnected()),
      }),
    );
    renderApp(TAB);
    region = await section();
    await within(region).findByText(/Şirketin GitHub'ı bağlı değil\./);
    expect(within(region).queryByRole('link')).toBeNull();
  });

  it('switched off: says that the connection was closed, and offers nothing of the repository', async () => {
    api(tab.notConnected(true));
    renderApp(TAB);
    const region = await section();
    expect(await within(region).findByText('GitHub bağlantısı kapatıldı.')).toBeVisible();
    expect(region).not.toHaveTextContent(ARMA_ORG);
    expect(button(region, 'Depoyu kaldır')).toBeNull();
    expect(button(region, 'Depoyu değiştir')).toBeNull();
  });

  it('no repository: who may link gets the button, everybody else reads who links', async () => {
    api(tab.noRepository({ canLink: true }));
    renderApp(TAB);
    let region = await section();
    expect(await within(region).findByText('Bu projeye GitHub deposu bağlı değil.')).toBeVisible();
    expect(button(region, 'Depo bağla')).toBeVisible();
    expect(region).not.toHaveTextContent('Depoyu projenin sahibi');
    cleanup();

    api(tab.noRepository());
    renderApp(TAB);
    region = await section();
    expect(
      await within(region).findByText('Depoyu projenin sahibi, yöneticileri ya da kurucu bağlar.'),
    ).toBeVisible();
    expect(button(region, 'Depo bağla')).toBeNull();
  });

  it('no repository and the customer allows no reading: no button, and the sentence of rule 12', async () => {
    api(tab.noRepository({ canLink: true, allowed: false }));
    renderApp(TAB);
    const region = await section();
    expect(
      await within(region).findByText(
        'Bu projenin müşterisinin sözleşme izinleri kapalı olduğu için depo bağlanamaz. Kurucu izinlerden birini açınca depo bağlanabilir.',
      ),
    ).toBeVisible();
    expect(button(region, 'Depo bağla')).toBeNull();
  });

  it("the customer's permission was closed: names the repository without a link, reads nothing, and only the removal is offered", async () => {
    api(tab.notAllowed({ canLink: true }));
    renderApp(TAB);
    const region = await section();
    expect(
      await within(region).findByText(
        'Bu projenin müşterisinin sözleşme izinleri kapalı olduğu için depo okunmuyor. Kurucu izinlerden birini açınca yeniden okunur.',
      ),
    ).toBeVisible();
    // The name the repository had when it was linked; no address is made out of it.
    expect(within(region).getByText(STORED.fullName)).toBeVisible();
    expect(within(region).queryByRole('link')).toBeNull();
    expect(within(region).queryByRole('list')).toBeNull();
    expect(region).not.toHaveTextContent('Son okuma');
    expect(button(region, 'Depoyu kaldır')).toBeVisible();
    expect(button(region, 'Depoyu değiştir')).toBeNull();
  });

  it.each([
    ['installation_gone', false],
    ['repository_gone', true],
    ['not_configured', false],
  ] as const)(
    'access is gone (%s): the sentence, no rows, and Depoyu değiştir only while a list can be asked for',
    async (reason, change) => {
      api(tab.unavailable({ reason, canLink: true }));
      renderApp(TAB);
      const region = await section();
      expect(await within(region).findByText(tabUnavailableText(reason))).toBeVisible();
      expect(within(region).queryByRole('list')).toBeNull();
      expect(within(region).queryByRole('link')).toBeNull();
      expect(button(region, 'Depoyu kaldır')).toBeVisible();
      expect(button(region, 'Depoyu değiştir') !== null).toBe(change);
    },
  );

  it('rate limited: shows the last lists with their time and says when GitHub is asked again', async () => {
    const retryAt = '2026-10-12T09:20:00.000Z';
    api(
      tab.unavailable({
        reason: 'rate_limited',
        retryAt,
        repository: LINKED,
        last: lists({ fetchedAt: '2026-10-12T09:01:00.000Z' }),
      }),
    );
    renderApp(TAB);
    const region = await section();
    expect(
      await within(region).findByText(
        `GitHub şu an yeni istek kabul etmiyor. Saat ${formatClock(retryAt)} sonrasında yeniden okunur.`,
      ),
    ).toBeVisible();
    expect(region).toHaveTextContent(`Son okuma: ${formatClock('2026-10-12T09:01:00.000Z')}`);
    expect(rowsOf('Son kod değişiklikleri')).toHaveLength(COMMITS.length);
  });

  it('GitHub down with nothing held: the sentence alone; with lists held: the lists too', async () => {
    api(tab.unavailable({ reason: 'github_down' }));
    renderApp(TAB);
    let region = await section();
    expect(
      await within(region).findByText("GitHub'a ulaşılamadı. Biraz sonra yeniden deneyin."),
    ).toBeVisible();
    expect(within(region).queryByRole('list')).toBeNull();
    cleanup();

    api(tab.unavailable({ reason: 'github_down', repository: LINKED, last: lists() }));
    renderApp(TAB);
    region = await section();
    await within(region).findByText("GitHub'a ulaşılamadı. Biraz sonra yeniden deneyin.");
    expect(rowsOf('Açık iş kayıtları')).toHaveLength(ISSUES.length);
  });

  it('a project the person may not read: the error of the API with a retry', async () => {
    const fake = api(tab.ok(), {
      [GITHUB]: () => apiError(409, 'private_space', 'GitHub bir şirkete bağlanır.'),
    });
    renderApp(TAB);
    const region = await section();
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'GitHub bir şirkete bağlanır.',
    );
    fake.handle(GITHUB, () => json(tab.ok()));
    await userEvent.click(within(region).getByRole('button', { name: 'Yeniden dene' }));
    expect(
      await within(region).findByRole('heading', { level: 4, name: 'Son kod değişiklikleri' }),
    ).toBeVisible();
  });
});

describe('the GitHub tab: reading again', () => {
  it('Yenile reads again as a request of the person and keeps the focus', async () => {
    const fake = api(tab.ok());
    renderApp(TAB);
    const region = await section();
    const refresh = await within(region).findByRole('button', { name: 'Yenile' });
    fake.handle(GITHUB, () =>
      json(tab.ok({ lists: lists({ issues: { items: [], more: false } }) })),
    );
    await userEvent.click(refresh);
    expect(await within(region).findByText('Açık iş kaydı yok.')).toBeVisible();
    expect(fake.callsTo(GITHUB)).toHaveLength(2);
    expect(fake.callsTo(GITHUB)[1]?.headers.has(BACKGROUND_HEADER)).toBe(false);
    expect(within(region).getByRole('button', { name: 'Yenile' })).toHaveFocus();
  });

  it('reads by itself every five minutes, as a background request, and not sooner', async () => {
    expect(GITHUB_TAB_REFRESH_MS).toBe(300_000);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fake = api(tab.ok());
      renderApp(TAB);
      const region = await section();
      await within(region).findByRole('heading', { level: 4, name: 'Açık iş kayıtları' });
      expect(fake.callsTo(GITHUB)).toHaveLength(1);
      // Half a minute, the pace of the other tabs, is not the pace of this one.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.callsTo(GITHUB)).toHaveLength(1);
      fake.handle(GITHUB, () =>
        json(tab.ok({ lists: lists({ issues: { items: [], more: false } }) })),
      );
      await vi.advanceTimersByTimeAsync(GITHUB_TAB_REFRESH_MS - 60_000 + 100);
      await waitFor(() => {
        expect(fake.callsTo(GITHUB)).toHaveLength(2);
      });
      // Not counted as activity: the session's idle time is not extended (rule 3).
      expect(fake.callsTo(GITHUB)[1]?.headers.get(BACKGROUND_HEADER)).toBe('1');
      expect(await within(region).findByText('Açık iş kaydı yok.')).toBeVisible();
      // The project itself is not read on a timer.
      expect(fake.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the GitHub tab: the repository of the project', () => {
  it('a plain member sees the lists and no button but Yenile', async () => {
    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [GITHUB]: () => json(tab.ok()),
      }),
    );
    renderApp(TAB);
    const region = await section();
    await within(region).findByRole('heading', { level: 4, name: 'Son kod değişiklikleri' });
    expect(
      within(region)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Yenile']);
  });

  it('who may link sees Depoyu değiştir and Depoyu kaldır beside Yenile', async () => {
    api(tab.ok({ canLink: true }));
    renderApp(TAB);
    const region = await section();
    await within(region).findByRole('heading', { level: 4, name: 'Son kod değişiklikleri' });
    expect(
      within(region)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Yenile', 'Depoyu değiştir', 'Depoyu kaldır']);
  });

  it("Depo bağla: lists the repositories by name, sends GitHub's number alone, then the tab reads the lists", async () => {
    const linked = projectDetail({ repository: { id: 102, fullName: `${ARMA_ORG}/panel` } });
    const fake = api(tab.noRepository({ canLink: true }), {
      [REPOSITORIES]: () => json(repositories()),
      [SET]: () => {
        fake.handle(GITHUB, () => json(tab.ok({ canLink: true })));
        return json(linked);
      },
    });
    renderApp(TAB);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Depo bağla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Depo bağla' });
    expect(dialog).toHaveTextContent(
      'Proje üyeleri bu deponun son değişikliklerini, açık değişiklik isteklerini ve iş kayıtlarını görür.',
    );
    const field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    expect(
      within(field)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Depo seçin', ...ARMA_REPOSITORIES.map((repository) => repository.fullName)]);
    // Nothing is chosen for the person, and nothing is sent without a choice.
    expect(field).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Depoyu bağla' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Bir depo seçin.');
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription('Bir depo seçin.');
    expect(fake.callsTo(SET)).toEqual([]);

    await userEvent.selectOptions(field, `${ARMA_ORG}/panel`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Depoyu bağla' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const [call] = fake.callsTo(SET);
    expect(call?.body).toEqual({ repositoryId: 102 });
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(await screen.findByText('Depo bağlandı.')).toBeVisible();
    // The tab read again and shows the lists of the repository.
    expect(
      await within(region).findByRole('heading', { level: 4, name: 'Son kod değişiklikleri' }),
    ).toBeVisible();
    // The button that opened the dialog is gone: the heading takes the focus.
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
    expect(fake.unexpected).toEqual([]);
  });

  it('Depoyu değiştir: starts from the repository the project has; Vazgeç sends nothing and returns the focus', async () => {
    const fake = api(tab.ok({ canLink: true }), {
      [REPOSITORIES]: () => json(repositories()),
      [SET]: () => {
        fake.handle(GITHUB, () =>
          json(
            tab.ok({
              canLink: true,
              repository: {
                id: 103,
                fullName: `${ARMA_ORG}/web-sitesi`,
                url: `https://github.com/${ARMA_ORG}/web-sitesi`,
              },
            }),
          ),
        );
        return json(projectDetail({ repository: { id: 103, fullName: `${ARMA_ORG}/web-sitesi` } }));
      },
    });
    renderApp(TAB);
    const region = await section();
    const change = await within(region).findByRole('button', { name: 'Depoyu değiştir' });
    await userEvent.click(change);
    let dialog = await screen.findByRole('dialog', { name: 'Depoyu değiştir' });
    let field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    expect(field).toHaveValue(String(LINKED.id));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(fake.callsTo(SET)).toEqual([]);
    expect(change).toHaveFocus();

    // Kaydet with the repository the project already has changes nothing and sends nothing.
    await userEvent.click(change);
    dialog = await screen.findByRole('dialog', { name: 'Depoyu değiştir' });
    await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(fake.callsTo(SET)).toEqual([]);
    expect(screen.queryByText('Depo değiştirildi.')).toBeNull();

    await userEvent.click(change);
    dialog = await screen.findByRole('dialog', { name: 'Depoyu değiştir' });
    field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    await userEvent.selectOptions(field, `${ARMA_ORG}/web-sitesi`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(fake.callsTo(SET)[0]?.body).toEqual({ repositoryId: 103 });
    expect(await screen.findByText('Depo değiştirildi.')).toBeVisible();
    expect(
      await within(region).findByRole('link', {
        name: `${ARMA_ORG}/web-sitesi, yeni sekmede açılır`,
      }),
    ).toBeVisible();
  });

  it('the dialog says so when the list cannot be read, is empty or the company is not connected', async () => {
    const cases: [answer: unknown, sentence: string, retry: boolean][] = [
      [REPOSITORIES_UNAVAILABLE, 'Depo listesi okunamadı. Biraz sonra yeniden deneyin.', true],
      [repositories([]), 'Bağlantının gördüğü depo yok.', true],
      [
        NO_REPOSITORIES,
        "Şirketin GitHub'ı bağlı değil. Kurucu, Ayarlar > Bağlantılar'dan bağlar.",
        false,
      ],
    ];
    for (const [answer, sentence, retry] of cases) {
      const fake = api(tab.unavailable({ reason: 'repository_gone', canLink: true }), {
        [REPOSITORIES]: () => json(answer),
      });
      renderApp(TAB);
      const region = await section();
      await userEvent.click(await within(region).findByRole('button', { name: 'Depoyu değiştir' }));
      const dialog = await screen.findByRole('dialog', { name: 'Depoyu değiştir' });
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(sentence);
      expect(within(dialog).queryByRole('combobox')).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Yeniden dene' }) !== null).toBe(retry);
      if (retry) {
        // The list is there now: the same dialog offers it.
        fake.handle(REPOSITORIES, () => json(repositories()));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Yeniden dene' }));
        const field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
        // The list offers the project's own repository: the dialog starts from it.
        expect(field).toHaveValue(String(LINKED.id));
      } else {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Kapat' }));
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).toBeNull();
        });
      }
      cleanup();
    }
  });

  it('starts with no choice when the repository of the project is no longer in the list', async () => {
    api(tab.unavailable({ reason: 'repository_gone', canLink: true }), {
      [REPOSITORIES]: () =>
        json(repositories(ARMA_REPOSITORIES.filter((repository) => repository.id !== LINKED.id))),
    });
    renderApp(TAB);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Depoyu değiştir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Depoyu değiştir' });
    const field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    expect(field).toHaveValue('');
    expect(within(field).queryByRole('option', { name: LINKED.fullName })).toBeNull();
  });

  it('a refusal of the API stays in the dialog; when it says the repository is gone the list is read again and the choice is taken back', async () => {
    const gone =
      'Bu depo, bağlantının gördüğü depolar arasında değil. Sayfayı yenileyip başka bir depo seçin.';
    const fake = api(tab.noRepository({ canLink: true }), {
      [REPOSITORIES]: () => json(repositories()),
      [SET]: () => {
        fake.handle(REPOSITORIES, () =>
          json(repositories(ARMA_REPOSITORIES.filter((repository) => repository.id !== 103))),
        );
        return apiError(409, 'github_repository_not_available', gone);
      },
    });
    renderApp(TAB);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Depo bağla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Depo bağla' });
    const field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    await userEvent.selectOptions(field, `${ARMA_ORG}/web-sitesi`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Depoyu bağla' }));
    expect(await within(dialog).findByText(gone)).toBeVisible();
    await waitFor(() => {
      expect(within(field).queryByRole('option', { name: `${ARMA_ORG}/web-sitesi` })).toBeNull();
    });
    expect(field).toHaveValue('');
    // Nothing reads as linked.
    expect(within(region).queryByRole('list')).toBeNull();
    expect(screen.queryByText('Depo bağlandı.')).toBeNull();
  });

  it('a refusal that is about the person or about rule 12 is said and the list is left alone', async () => {
    const fake = api(tab.noRepository({ canLink: true }), {
      [REPOSITORIES]: () => json(repositories()),
      [SET]: () =>
        apiError(
          403,
          'project_repository_not_allowed',
          'Projenin deposunu yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.',
        ),
    });
    renderApp(TAB);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Depo bağla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Depo bağla' });
    const field = await within(dialog).findByRole('combobox', { name: 'GitHub deposu' });
    await userEvent.selectOptions(field, `${ARMA_ORG}/panel`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Depoyu bağla' }));
    expect(
      await within(dialog).findByText(
        'Projenin deposunu yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.',
      ),
    ).toBeVisible();
    expect(field).toHaveValue('102');
    expect(fake.callsTo(REPOSITORIES)).toHaveLength(1);
  });

  it('Depoyu kaldır asks plainly, Vazgeç first, and touches nothing on GitHub', async () => {
    const fake = api(tab.ok({ canLink: true }), {
      [REMOVE]: () => {
        fake.handle(GITHUB, () => json(tab.noRepository({ canLink: true })));
        return json(projectDetail());
      },
    });
    renderApp(TAB);
    const region = await section();
    const remove = await within(region).findByRole('button', { name: 'Depoyu kaldır' });
    await userEvent.click(remove);
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Bu projenin GitHub deposu kaldırılsın mı?',
    });
    expect(dialog).toHaveTextContent("Depoya ve GitHub'daki hiçbir şeye dokunulmaz.");
    expect(within(dialog).getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(fake.callsTo(REMOVE)).toEqual([]);
    expect(remove).toHaveFocus();

    await userEvent.click(remove);
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Depoyu kaldır' }));
    expect(await within(region).findByText('Bu projeye GitHub deposu bağlı değil.')).toBeVisible();
    expect(fake.callsTo(REMOVE)).toHaveLength(1);
    expect(fake.callsTo(REMOVE)[0]?.body).toBeUndefined();
    expect(await screen.findByText('Depo projeden kaldırıldı.')).toBeVisible();
    // No passkey for either act of the tab.
    expect(fake.callsTo('POST /step-up/options')).toEqual([]);
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it("shows the API's refusal of a removal in the dialog and keeps the lists", async () => {
    api(tab.ok({ canLink: true }), {
      [REMOVE]: () =>
        apiError(
          403,
          'project_repository_not_allowed',
          'Projenin deposunu yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.',
        ),
    });
    renderApp(TAB);
    const region = await section();
    await userEvent.click(await within(region).findByRole('button', { name: 'Depoyu kaldır' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Depoyu kaldır' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Projenin deposunu yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.',
    );
    // Behind the open dialog the rows are still there.
    expect(
      screen.getByRole('list', { name: 'Son kod değişiklikleri', hidden: true }),
    ).toBeInTheDocument();
  });
});

describe('the GitHub tab: the tab panel', () => {
  it('is the only panel on screen and is named after its tab', async () => {
    api(tab.ok());
    renderApp(TAB);
    expect(await panel()).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});
