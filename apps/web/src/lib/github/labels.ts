import {
  GITHUB_PERMISSIONS,
  GITHUB_REPOSITORY_LIMIT,
  type GithubConnection,
  type GithubConnectionProblem,
  type GithubPermission,
  type GithubRepositorySelection,
  type ProjectGithubUnavailableReason,
  type TaskPerson,
} from '@agent-office/shared';
import { FORBIDDEN_MESSAGE } from '../api.ts';

/**
 * Every sentence of the GitHub connection in one place: Ayarlar > Bağlantılar, the repository
 * field of a project and the "GitHub" tab (docs/SONRA.md P5-h: written without being asked for).
 *
 * The words GitHub itself uses on its screens ("All repositories", "Read-only", the names of the
 * four permissions) stay as GitHub writes them: the founder has to find them there.
 */

/** The founder's page, opened by somebody else. */
export const CONNECTIONS_FOUNDER_ONLY = `${FORBIDDEN_MESSAGE} GitHub bağlantısını kurucu yönetir.`;

/** The founder's private space has no GitHub connection. */
export const CONNECTIONS_PRIVATE_SPACE = {
  title: 'GitHub bir şirkete bağlanır',
  description: 'Şirket seçiciden bir şirket seçin.',
} as const;

export function connectionsIntro(company: string): string {
  return `${company} şirketinin dış bağlantıları. Her şirket kendi GitHub kuruluşuna bir kez bağlanır; bağlantı yalnızca okur.`;
}

export function notConfiguredText(company: string): string {
  return `Bu ortamda ${company} için GitHub uygulaması ayarlı değil. Önce GitHub'da ${company} kuruluşunun içinde uygulama oluşturulmalı ve anahtarı sunucunun ayarlarına konmalı.`;
}

export function notInstalledText(organization: string): string {
  return `GitHub uygulaması ${organization} kuruluşuna henüz kurulmamış. Kurarken 'All repositories' (bütün depolar) seçin.`;
}
export const NOT_INSTALLED_HINT =
  'Kurulumu bitirdiyseniz ve bu sayfa değişmediyse sayfayı yenileyin.';
/** The API gave an install address the panel does not turn into a link. */
export const NO_INSTALL_LINK =
  "Kurulum bağlantısı oluşturulamadı. Uygulamayı GitHub'da kuruluşun ayarlarından kurun.";

const TOO_WIDE =
  "Uygulamanın GitHub'daki izinleri beklenenden geniş. Panel yalnızca dört okuma izniyle bağlanır: Metadata, Contents, Pull requests, Issues; hepsi 'Read-only'. İzinleri düzeltin, sonra bu sayfayı yenileyin.";

/** Why the app, or its installation, cannot be connected, and how that is put right. */
export function invalidText(
  invalid: Pick<
    Extract<GithubConnection, { state: 'invalid' }>,
    'reason' | 'organization' | 'actualOwner'
  >,
  company: string,
): string {
  switch (invalid.reason) {
    case 'owner_mismatch':
      return `Sunucudaki GitHub ayarı ${company} için ${invalid.organization} kuruluşunu bekliyor, ama uygulama ${
        invalid.actualOwner === null ? 'başka bir hesaba' : `${invalid.actualOwner} kuruluşuna`
      } ait. Sunucudaki ayar denetlenmeli; bu düzelmeden bağlanılamaz.`;
    case 'owner_not_organization':
      return `Uygulama GitHub'da bir kuruluşa değil, bir kişinin hesabına ait. Uygulama ${invalid.organization} kuruluşunun içinde oluşturulmalı; bu düzelmeden bağlanılamaz.`;
    case 'suspended':
      return "Uygulama GitHub'da durdurulmuş. GitHub'da yeniden açın, sonra bu sayfayı yenileyin.";
    case 'write_permission':
    case 'other_permission':
      return TOO_WIDE;
  }
}

const GITHUB_DOWN = "GitHub'a ulaşılamadı. Biraz sonra yeniden deneyin.";
const KEY_REFUSED = 'GitHub uygulamasının anahtarı kabul edilmedi. Sunucudaki ayar denetlenmeli.';
const RATE_LIMITED = 'GitHub şu an yeni istek kabul etmiyor. Biraz sonra yeniden deneyin.';
const INSTALLATION_GONE =
  "GitHub bağlantısı çalışmıyor: uygulama GitHub'da kaldırılmış ya da durdurulmuş.";

/** GitHub could not be asked for the state of the connection. */
export const CONNECTION_UNAVAILABLE: Record<
  Extract<GithubConnection, { state: 'unavailable' }>['reason'],
  string
> = {
  github_down: GITHUB_DOWN,
  key_refused: KEY_REFUSED,
  rate_limited: RATE_LIMITED,
};

/** Why a connected company's connection does not work just now. */
export const CONNECTION_PROBLEM: Record<GithubConnectionProblem, string> = {
  // A reinstalled app is a new installation with a new number, which the connection does not name.
  installation_gone: `${INSTALLATION_GONE} Uygulama yeniden kurulduysa önce 'Bağlantıyı kes', sonra 'GitHub'ı bağla' deyin.`,
  suspended:
    "GitHub bağlantısı çalışmıyor: uygulama GitHub'da durdurulmuş. GitHub'da yeniden açın, sonra bu sayfayı yenileyin.",
  github_down: GITHUB_DOWN,
  key_refused: KEY_REFUSED,
  rate_limited: RATE_LIMITED,
};

/** "Listeyi yenile" is offered while asking GitHub again can help. */
export function canRefreshList(problem: GithubConnectionProblem | null): boolean {
  return problem === null || problem === 'github_down' || problem === 'rate_limited';
}

export function installedText(organization: string): string {
  return `${organization} kuruluşuna kurulu.`;
}

/** Which repositories the installation reaches, before the company is connected. */
export const INSTALLED_SELECTION: Record<GithubRepositorySelection, string> = {
  all: 'Uygulama bu kuruluştaki bütün depoları görüyor.',
  selected:
    "Uygulama bu kuruluşta yalnızca GitHub'da seçilen depoları görüyor. Bütün depoları görmesi için GitHub'da 'All repositories' seçin.",
};

/** What connecting leads to, said before the founder confirms (12 October decisions 15 and 16). */
export function whatConnectingDoes(company: string): string {
  return `Bağlandığında ${company} şirketinde proje açan herkes bu depoların adını görür ve birini projesine ekleyebilir; proje üyeleri o deponun son değişikliklerini, açık değişiklik isteklerini ve iş kayıtlarını, yazanların GitHub kullanıcı adlarıyla görür. Bağlantı yalnızca okur.`;
}

/** The connection was switched off before: the projects' repositories are still linked. */
export const WAS_CONNECTED =
  'Bu şirketin bağlantısı daha önce kesildi. Yeniden bağladığınızda projelere bağlı depolar geri gelir.';

const PERMISSION_NAME: Record<GithubPermission, string> = {
  metadata: 'Metadata',
  contents: 'Contents',
  pull_requests: 'Pull requests',
  issues: 'Issues',
};

/**
 * The installation lacks one of the four read permissions: it still connects, and the list that
 * needs the permission cannot be read. Null when all four are there.
 */
export function missingPermissionsText(permissions: readonly GithubPermission[]): string | null {
  const missing = GITHUB_PERMISSIONS.filter((permission) => !permissions.includes(permission));
  if (missing.length === 0) return null;
  const names = missing.map((permission) => PERMISSION_NAME[permission]).join(', ');
  return `Uygulamada şu okuma izinleri eksik: ${names}. Eksik iznin listesi GitHub sekmesinde okunamaz; izni GitHub'da uygulamanın ayarlarından 'Read-only' olarak ekleyin.`;
}

export function connectDialogText(
  organization: string,
  company: string,
): { title: string; description: string; confirmLabel: string } {
  return {
    title: 'GitHub bağlansın mı?',
    description: `${organization} kuruluşunu ${company} şirketine bağlamayı passkey ile onaylayın.`,
    confirmLabel: "GitHub'ı bağla",
  };
}

/** The words before the time of connecting: who connected, when a person did. */
export function connectedLead(organization: string, connectedBy: TaskPerson | null): string {
  const lead = `${organization} kuruluşuna bağlı.`;
  // null: written without a person. A name of null: the person is no longer in the company.
  if (connectedBy === null) return `${lead} Bağlandığı gün:`;
  return `${lead} Bağlayan: ${connectedBy.name ?? 'eski üye'},`;
}

/** Which repositories the connection reaches, and how many. */
export function connectedSelection(selection: GithubRepositorySelection, count: number): string {
  const repositories = `${String(count)} depo`;
  return selection === 'all'
    ? `Uygulama kuruluştaki bütün depoları görüyor: ${repositories}.`
    : `Uygulama yalnızca GitHub'da seçilen depoları görüyor: ${repositories}.`;
}

export function linkedProjectsText(count: number): string {
  return `Deposu bağlı proje sayısı: ${String(count)}.`;
}

export function disconnectDialogText(company: string): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  return {
    title: `${company} şirketinin GitHub bağlantısı kesilsin mi?`,
    description:
      "Projelerdeki GitHub sekmeleri boş kalır ve yeni projede depo seçilemez. Projelere bağlı depolar silinmez; yeniden bağladığınızda geri gelir. Uygulama GitHub'da kurulu kalır; tamamen kaldırmak için GitHub'da kuruluş ayarlarından kaldırın.",
    confirmLabel: 'Bağlantıyı kes',
  };
}

export const CONNECTION_DONE = {
  connected: 'GitHub bağlandı.',
  disconnected: 'GitHub bağlantısı kesildi.',
  listRead: 'Depo listesi yeniden okundu.',
  listNotRead: 'Depo listesi okunamadı. Biraz sonra yeniden deneyin.',
} as const;

// The repository of a project -------------------------------------------------------------------

/** The repository field of "Yeni proje" and of the repository dialog. */
export const REPOSITORY_FIELD = {
  label: 'GitHub deposu (isteğe bağlı)',
  none: 'Depo yok',
  help: 'Proje üyeleri bu deponun son değişikliklerini, açık değişiklik isteklerini ve iş kayıtlarını görür.',
  truncated: `Liste çok uzun; ilk ${String(GITHUB_REPOSITORY_LIMIT)} depo gösteriliyor.`,
} as const;

export const REPOSITORY_DIALOG = {
  link: { title: 'Depo bağla', confirm: 'Depoyu bağla', done: 'Depo bağlandı.' },
  change: { title: 'Depoyu değiştir', confirm: 'Kaydet', done: 'Depo değiştirildi.' },
  label: 'GitHub deposu',
  choose: 'Depo seçin',
  chooseProblem: 'Bir depo seçin.',
  // The project's repository is no longer among the ones the connection sees.
  goneOption: (fullName: string) => `${fullName} (artık görünmüyor)`,
  notConnected: "Şirketin GitHub'ı bağlı değil. Kurucu, Ayarlar > Bağlantılar'dan bağlar.",
  unavailable: 'Depo listesi okunamadı. Biraz sonra yeniden deneyin.',
  empty: 'Bağlantının gördüğü depo yok.',
} as const;

export const REMOVE_REPOSITORY = {
  title: 'Bu projenin GitHub deposu kaldırılsın mı?',
  description: "Depoya ve GitHub'daki hiçbir şeye dokunulmaz.",
  confirm: 'Depoyu kaldır',
  done: 'Depo projeden kaldırıldı.',
} as const;

// The "GitHub" tab ------------------------------------------------------------------------------

export const TAB_TEXT = {
  heading: 'GitHub',
  refresh: 'Yenile',
  change: 'Depoyu değiştir',
  remove: 'Depoyu kaldır',
  link: 'Depo bağla',
  archived: '(arşivlenmiş)',
  lastRead: 'Son okuma:',
  newTab: '(yeni sekmede açılır)',
  notConnected: "Şirketin GitHub'ı bağlı değil. Kurucu, Ayarlar > Bağlantılar'dan bağlar.",
  disconnected: 'GitHub bağlantısı kapatıldı.',
  openConnections: "Bağlantılar'ı aç",
  noRepository: 'Bu projeye GitHub deposu bağlı değil.',
  whoLinks: 'Depoyu projenin sahibi, yöneticileri ya da kurucu bağlar.',
  // Rule 12, for a project without a repository and for one that has one.
  linkNotAllowed:
    'Bu projenin müşterisinin sözleşme izinleri kapalı olduğu için depo bağlanamaz. Kurucu izinlerden birini açınca depo bağlanabilir.',
  notAllowed:
    'Bu projenin müşterisinin sözleşme izinleri kapalı olduğu için depo okunmuyor. Kurucu izinlerden birini açınca yeniden okunur.',
  listNotRead: 'Bu liste okunamadı.',
  more: "Daha fazlası GitHub'da.",
  draft: 'taslak',
} as const;

/** The three lists: the heading, and the sentence of an empty list. */
export const LISTS = {
  commits: { heading: 'Son kod değişiklikleri', empty: 'Bu depoda henüz kod değişikliği yok.' },
  pullRequests: { heading: 'Açık değişiklik istekleri', empty: 'Açık değişiklik isteği yok.' },
  issues: { heading: 'Açık iş kayıtları', empty: 'Açık iş kaydı yok.' },
} as const;

/**
 * Why the lists of the project's repository cannot be read just now. `retryAt` is the time GitHub
 * takes requests again, already written as a clock time; only the rate limit has one.
 */
export function tabUnavailableText(
  reason: ProjectGithubUnavailableReason,
  retryAt: string | null = null,
): string {
  switch (reason) {
    case 'installation_gone':
      return `${INSTALLATION_GONE} Kurucu, Ayarlar > Bağlantılar'dan denetleyebilir.`;
    case 'repository_gone':
      return 'Bu depo artık bağlantının gördüğü depolar arasında değil.';
    case 'rate_limited':
      return retryAt === null
        ? 'GitHub şu an yeni istek kabul etmiyor. Biraz sonra yeniden okunur.'
        : `GitHub şu an yeni istek kabul etmiyor. Saat ${retryAt} sonrasında yeniden okunur.`;
    case 'github_down':
      return GITHUB_DOWN;
    case 'not_configured':
      return 'Bu ortamda bu şirket için GitHub uygulaması ayarlı değil; depo okunamıyor.';
  }
}

/** "Depoyu değiştir" needs the list of repositories, so it is offered while GitHub can be asked. */
export function canChangeRepository(reason: ProjectGithubUnavailableReason): boolean {
  return reason === 'repository_gone' || reason === 'rate_limited' || reason === 'github_down';
}

/** Who wrote a commit, in words; a GitHub user name is written as GitHub gives it. */
export function wroteText(author: string): string {
  return `${author} yazdı`;
}
/** Who opened a pull request or an issue. */
export function openedText(author: string): string {
  return `${author} açtı`;
}
/** A commit is named by the first seven characters of its number. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
