import { describe, expect, it } from 'vitest';
import {
  canChangeRepository,
  canRefreshList,
  connectDialogText,
  connectedLead,
  connectedSelection,
  CONNECTION_PROBLEM,
  disconnectDialogText,
  invalidText,
  missingPermissionsText,
  notConfiguredText,
  notInstalledText,
  openedText,
  REPOSITORY_FIELD,
  shortSha,
  tabUnavailableText,
  whatConnectingDoes,
  wroteText,
} from './labels.ts';
import * as labels from './labels.ts';

const USER = '9c4f5d6e-7a8b-4c93-bd04-3e5f6a7b8c93';

describe('the sentences of the GitHub connection', () => {
  it('names the company where the environment has no app for it', () => {
    expect(notConfiguredText('Pillika')).toBe(
      "Bu ortamda Pillika için GitHub uygulaması ayarlı değil. Önce GitHub'da Pillika kuruluşunun içinde uygulama oluşturulmalı ve anahtarı sunucunun ayarlarına konmalı.",
    );
  });

  it('tells the founder to choose all repositories when installing', () => {
    expect(notInstalledText('arma-org')).toBe(
      "GitHub uygulaması arma-org kuruluşuna henüz kurulmamış. Kurarken 'All repositories' (bütün depolar) seçin.",
    );
  });

  it('says of an app owned by somebody else which organisation was expected and which owns it', () => {
    const invalid = { reason: 'owner_mismatch', organization: 'arma-org' } as const;
    expect(invalidText({ ...invalid, actualOwner: 'pillika-org' }, 'Arma DX')).toBe(
      'Sunucudaki GitHub ayarı Arma DX için arma-org kuruluşunu bekliyor, ama uygulama pillika-org kuruluşuna ait. Sunucudaki ayar denetlenmeli; bu düzelmeden bağlanılamaz.',
    );
    // GitHub named no owner.
    expect(invalidText({ ...invalid, actualOwner: null }, 'Arma DX')).toContain(
      'ama uygulama başka bir hesaba ait.',
    );
  });

  it('has a sentence for every other reason an app cannot be connected', () => {
    const of = (reason: Parameters<typeof invalidText>[0]['reason']) =>
      invalidText({ reason, organization: 'arma-org', actualOwner: null }, 'Arma DX');
    expect(of('owner_not_organization')).toBe(
      "Uygulama GitHub'da bir kuruluşa değil, bir kişinin hesabına ait. Uygulama arma-org kuruluşunun içinde oluşturulmalı; bu düzelmeden bağlanılamaz.",
    );
    expect(of('suspended')).toBe(
      "Uygulama GitHub'da durdurulmuş. GitHub'da yeniden açın, sonra bu sayfayı yenileyin.",
    );
    // A write permission and a permission outside the four are put right the same way.
    expect(of('write_permission')).toBe(of('other_permission'));
    expect(of('write_permission')).toContain(
      "Panel yalnızca dört okuma izniyle bağlanır: Metadata, Contents, Pull requests, Issues; hepsi 'Read-only'.",
    );
  });

  it('says what connecting leads to, with the company', () => {
    expect(whatConnectingDoes('Arma DX')).toBe(
      'Bağlandığında Arma DX şirketinde proje açan herkes bu depoların adını görür ve birini projesine ekleyebilir; proje üyeleri o deponun son değişikliklerini, açık değişiklik isteklerini ve iş kayıtlarını, yazanların GitHub kullanıcı adlarıyla görür. Bağlantı yalnızca okur.',
    );
  });

  it('names a missing read permission as GitHub writes it, and nothing when all four are there', () => {
    expect(missingPermissionsText(['metadata', 'contents', 'pull_requests', 'issues'])).toBeNull();
    expect(missingPermissionsText(['metadata', 'pull_requests'])).toBe(
      "Uygulamada şu okuma izinleri eksik: Contents, Issues. Eksik iznin listesi GitHub sekmesinde okunamaz; izni GitHub'da uygulamanın ayarlarından 'Read-only' olarak ekleyin.",
    );
  });

  it('asks the passkey for the organisation and the company the page shows', () => {
    expect(connectDialogText('pillika-org', 'Pillika')).toEqual({
      title: 'GitHub bağlansın mı?',
      description: 'pillika-org kuruluşunu Pillika şirketine bağlamayı passkey ile onaylayın.',
      confirmLabel: "GitHub'ı bağla",
    });
  });

  it('says who connected, also when the person left and when nobody did', () => {
    expect(connectedLead('arma-org', { userId: USER, name: 'Ömer Kadıoğlu' })).toBe(
      'arma-org kuruluşuna bağlı. Bağlayan: Ömer Kadıoğlu,',
    );
    expect(connectedLead('arma-org', { userId: USER, name: null })).toBe(
      'arma-org kuruluşuna bağlı. Bağlayan: eski üye,',
    );
    expect(connectedLead('arma-org', null)).toBe('arma-org kuruluşuna bağlı. Bağlandığı gün:');
  });

  it('says which repositories the connection reaches, and how many', () => {
    expect(connectedSelection('all', 12)).toBe(
      'Uygulama kuruluştaki bütün depoları görüyor: 12 depo.',
    );
    expect(connectedSelection('selected', 1)).toBe(
      "Uygulama yalnızca GitHub'da seçilen depoları görüyor: 1 depo.",
    );
  });

  it('tells a founder whose app was installed again to disconnect first', () => {
    expect(CONNECTION_PROBLEM.installation_gone).toBe(
      "GitHub bağlantısı çalışmıyor: uygulama GitHub'da kaldırılmış ya da durdurulmuş. Uygulama yeniden kurulduysa önce 'Bağlantıyı kes', sonra 'GitHub'ı bağla' deyin.",
    );
  });

  it('offers to read the list again only while asking GitHub can help', () => {
    expect(canRefreshList(null)).toBe(true);
    expect(canRefreshList('github_down')).toBe(true);
    expect(canRefreshList('rate_limited')).toBe(true);
    expect(canRefreshList('installation_gone')).toBe(false);
    expect(canRefreshList('suspended')).toBe(false);
    expect(canRefreshList('key_refused')).toBe(false);
  });

  it('names the company in the question of the disconnect dialog and says what stays', () => {
    const text = disconnectDialogText('Arma DX');
    expect(text.title).toBe('Arma DX şirketinin GitHub bağlantısı kesilsin mi?');
    expect(text.description).toBe(
      "Projelerdeki GitHub sekmeleri boş kalır ve yeni projede depo seçilemez. Projelere bağlı depolar silinmez; yeniden bağladığınızda geri gelir. Uygulama GitHub'da kurulu kalır; tamamen kaldırmak için GitHub'da kuruluş ayarlarından kaldırın.",
    );
    expect(text.confirmLabel).toBe('Bağlantıyı kes');
  });
});

describe('the sentences of a project and its GitHub tab', () => {
  it('says how long the repository list can be', () => {
    expect(REPOSITORY_FIELD.truncated).toBe('Liste çok uzun; ilk 1000 depo gösteriliyor.');
  });

  it('has a sentence for every reason the lists cannot be read', () => {
    expect(tabUnavailableText('installation_gone')).toBe(
      "GitHub bağlantısı çalışmıyor: uygulama GitHub'da kaldırılmış ya da durdurulmuş. Kurucu, Ayarlar > Bağlantılar'dan denetleyebilir.",
    );
    expect(tabUnavailableText('repository_gone')).toBe(
      'Bu depo artık bağlantının gördüğü depolar arasında değil.',
    );
    expect(tabUnavailableText('github_down')).toBe(
      "GitHub'a ulaşılamadı. Biraz sonra yeniden deneyin.",
    );
    expect(tabUnavailableText('not_configured')).toBe(
      'Bu ortamda bu şirket için GitHub uygulaması ayarlı değil; depo okunamıyor.',
    );
  });

  it('says when GitHub takes requests again, when the API knows it', () => {
    expect(tabUnavailableText('rate_limited', '14:32')).toBe(
      'GitHub şu an yeni istek kabul etmiyor. Saat 14:32 sonrasında yeniden okunur.',
    );
    expect(tabUnavailableText('rate_limited')).toBe(
      'GitHub şu an yeni istek kabul etmiyor. Biraz sonra yeniden okunur.',
    );
  });

  it('offers another repository only while the list of repositories can be asked for', () => {
    expect(canChangeRepository('repository_gone')).toBe(true);
    expect(canChangeRepository('github_down')).toBe(true);
    expect(canChangeRepository('rate_limited')).toBe(true);
    expect(canChangeRepository('installation_gone')).toBe(false);
    expect(canChangeRepository('not_configured')).toBe(false);
  });

  it('writes who did what in words and a commit by seven characters', () => {
    expect(wroteText('ayse-k')).toBe('ayse-k yazdı');
    expect(openedText('mehmet')).toBe('mehmet açtı');
    expect(shortSha('a1b2c3d4e5'.repeat(4))).toBe('a1b2c3d');
  });
});

describe('the style of the sentences', () => {
  /** Every sentence the module holds or builds, with sample values. */
  function sentences(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (typeof value === 'function') return [];
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(sentences);
    return [];
  }

  it('uses no em dash and no dotted separator', () => {
    const all = sentences(labels);
    expect(all.length).toBeGreaterThan(40);
    for (const sentence of all) {
      expect(sentence).not.toMatch(/[—·]/);
    }
  });
});
