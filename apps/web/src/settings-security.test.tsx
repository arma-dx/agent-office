import type { Passkey } from '@agent-office/shared';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  ARMADX,
  json,
  mockApi,
  noContent,
  sessionHandler,
  type Handler,
} from './test/mock-api.ts';
import {
  ASSERTION,
  ATTESTATION,
  cancelledByPerson,
  challengeId,
  passkey,
  REGISTRATION_OPTIONS,
  signed,
  STEP_UP_OPTIONS,
  stepUpIssuer,
} from './test/passkeys.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';
import { formatDate, formatDateTime } from './lib/users.ts';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
  vi.mocked(startRegistration).mockReset().mockResolvedValue(ATTESTATION);
  vi.mocked(browserSupportsWebAuthn).mockReset().mockReturnValue(true);
});

const MACBOOK = passkey();
const IPHONE = passkey({
  id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
  name: 'iPhone',
  createdAt: '2026-10-02T08:00:00.000Z',
  lastUsedAt: null,
});
const SECURITY_PAGE = '/c/armadx/settings/security';
const EMPLOYEE_MEMBERSHIP = { ...ARMADX, role: 'employee' as const, canApprove: false };

/** The API with a passkey list that the handlers can change, as registration and removal do. */
function securityApi(initial: Passkey[], extra: Record<string, Handler> = {}) {
  let passkeys = initial;
  const api = mockApi({
    'GET /session': sessionHandler(),
    'GET /passkeys': () => json({ passkeys }),
    ...extra,
  });
  return {
    ...api,
    setPasskeys(next: Passkey[]) {
      passkeys = next;
    },
  };
}

function currentEventType(): string | undefined {
  return (globalThis as { event?: Event }).event?.type;
}

async function openAddDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Passkey ekle' }));
  return screen.findByRole('dialog', { name: 'Passkey ekle' });
}

describe('settings, security: the page', () => {
  it('is in the user menu next to Kullanıcılar and explains why passkeys are asked', async () => {
    securityApi([MACBOOK]);
    const { router } = renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Kullanıcılar', 'Güvenlik', 'Çıkış yap', 'Bütün oturumları kapat']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Güvenlik' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Güvenlik' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe(SECURITY_PAGE);
    expect(
      screen.getByText(
        'Önemli onaylar ve üye değişiklikleri için parmak izi ya da yüz tanımayla yeniden doğrulama istenir. İki cihazda passkey eklemeniz önerilir.',
      ),
    ).toBeVisible();
  });

  it('is offered to an employee', async () => {
    mockApi({
      'GET /session': sessionHandler({ memberships: [EMPLOYEE_MEMBERSHIP] }),
      'GET /passkeys': () => json({ passkeys: [] }),
    });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Kullanıcılar' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Güvenlik' })).toHaveAttribute(
      'href',
      SECURITY_PAGE,
    );
  });

  it('is offered in the private space', async () => {
    securityApi([]);
    renderApp('/c/founder_space');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Güvenlik' })).toHaveAttribute(
      'href',
      '/c/founder_space/settings/security',
    );
  });

  it('lists the passkeys with their name, the day they were added and their last use', async () => {
    securityApi([MACBOOK, IPHONE]);
    renderApp(SECURITY_PAGE);
    const macbook = await screen.findByRole('group', { name: 'MacBook' });
    expect(macbook).toHaveTextContent(`Eklendi: ${formatDate(MACBOOK.createdAt)}`);
    expect(macbook).toHaveTextContent(`Son kullanım: ${formatDateTime(MACBOOK.lastUsedAt!)}`);
    expect(within(macbook).getByRole('button', { name: 'Kaldır' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'iPhone' })).toHaveTextContent(
      'Son kullanım: henüz kullanılmadı',
    );
    expect(screen.queryByText(/Yalnızca bir passkey'iniz var/)).toBeNull();
  });

  it('shows the first step when there is no passkey', async () => {
    securityApi([]);
    renderApp(SECURITY_PAGE);
    expect(await screen.findByText('Henüz passkey yok')).toBeVisible();
    expect(
      screen.getByText(
        "Passkey ekle düğmesiyle bu cihazda ilk passkey'inizi ekleyin. İlk passkey, Google ile girişten sonraki 10 dakika içinde eklenebilir.",
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Passkey ekle' })).toBeVisible();
  });

  it('recommends a second device when there is only one passkey', async () => {
    securityApi([MACBOOK]);
    renderApp(SECURITY_PAGE);
    expect(
      await screen.findByText(
        "Yalnızca bir passkey'iniz var. Bu cihazı kaybederseniz önemli işlemleri onaylayamazsınız; ikinci bir cihazda da passkey ekleyin.",
      ),
    ).toBeVisible();
  });

  it('says so when the browser has no passkeys, and offers no adding', async () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    securityApi([MACBOOK]);
    renderApp(SECURITY_PAGE);
    await screen.findByRole('group', { name: 'MacBook' });
    expect(screen.getByText(/^Bu tarayıcı passkey desteklemiyor\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Passkey ekle' })).toBeNull();
  });

  it('offers no adding at 10 passkeys', async () => {
    securityApi(
      Array.from({ length: 10 }, (_, n) =>
        passkey({
          id: `1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c${String(n).padStart(2, '0')}`,
          name: `Cihaz ${String(n + 1)}`,
        }),
      ),
    );
    renderApp(SECURITY_PAGE);
    expect(
      await screen.findByText(
        'En fazla 10 passkey kaydedilebilir. Yenisini eklemek için önce kullanmadığınız birini kaldırın.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Passkey ekle' })).toBeNull();
  });
});

describe('settings, security: adding a passkey', () => {
  it('adds the first passkey: the name, then the browser creates it in a second press', async () => {
    const api = securityApi([], {
      'POST /passkeys/registration/options': () =>
        json({ challengeId: challengeId(1), options: REGISTRATION_OPTIONS }),
    });
    api.handle('POST /passkeys/registration', () => {
      api.setPasskeys([MACBOOK]);
      return json(MACBOOK, 201);
    });
    let atCeremony: { event: string | undefined; calls: number } | undefined;
    vi.mocked(startRegistration).mockImplementation(() => {
      atCeremony = { event: currentEventType(), calls: api.calls.length };
      return Promise.resolve(ATTESTATION);
    });
    renderApp(SECURITY_PAGE);
    const dialog = await openAddDialog();
    // The first passkey needs no re-verification.
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
    expect(within(dialog).queryByText(/kayıtlı passkey'lerinizden biriyle/)).toBeNull();

    await userEvent.type(within(dialog).getByLabelText('Ad'), '  MacBook ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    const create = await within(dialog).findByRole('button', { name: 'Passkey oluştur' });
    expect(api.callsTo('POST /passkeys/registration/options').map((c) => c.body)).toEqual([
      { name: 'MacBook' },
    ]);
    expect(startRegistration).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("Şimdi bu cihazda MacBook adlı passkey'i oluşturun.");
    expect(create).toHaveFocus();

    const callsBeforeClick = api.calls.length;
    await userEvent.click(create);
    expect(atCeremony).toEqual({ event: 'click', calls: callsBeforeClick });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: REGISTRATION_OPTIONS });
    expect(await screen.findByText('Passkey eklendi.')).toBeVisible();
    expect(api.callsTo('POST /passkeys/registration').map((c) => c.body)).toEqual([
      { challengeId: challengeId(1), name: 'MacBook', response: ATTESTATION },
    ]);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await screen.findByRole('group', { name: 'MacBook' })).toBeVisible();
  });

  it('checks the name in Turkish and asks nothing while it is wrong', async () => {
    const api = securityApi([]);
    renderApp(SECURITY_PAGE);
    const dialog = await openAddDialog();
    const name = within(dialog).getByLabelText('Ad');
    await userEvent.type(name, '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    expect(
      await within(dialog).findByText('Passkey için bir ad yazın, örneğin MacBook.'),
    ).toBeVisible();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();

    await userEvent.clear(name);
    await userEvent.type(name, 'x'.repeat(61));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    expect(await within(dialog).findByText('Ad en çok 60 karakter olabilir.')).toBeVisible();
    expect(api.callsTo('POST /passkeys/registration/options')).toEqual([]);
  });

  it('adds a further passkey after a verification with a passkey already registered', async () => {
    const stepUp = stepUpIssuer();
    const api = securityApi([MACBOOK], {
      'POST /step-up/options': stepUp.handler,
      'POST /passkeys/registration/options': () =>
        json({ challengeId: challengeId(50), options: REGISTRATION_OPTIONS }),
    });
    api.handle('POST /passkeys/registration', () => {
      api.setPasskeys([MACBOOK, IPHONE]);
      return json(IPHONE, 201);
    });
    let atCeremony: { event: string | undefined; calls: number } | undefined;
    vi.mocked(startAuthentication).mockImplementation(() => {
      atCeremony = { event: currentEventType(), calls: api.calls.length };
      return Promise.resolve(ASSERTION);
    });
    renderApp(SECURITY_PAGE);
    await screen.findByRole('group', { name: 'MacBook' });
    expect(api.callsTo('POST /step-up/options')).toEqual([]);

    const dialog = await openAddDialog();
    // The options for the passkey_add verification come when the dialog opens.
    await waitFor(() => {
      expect(stepUp.issued.map((i) => i.body)).toEqual([{ purpose: 'passkey_add' }]);
    });
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'iPhone');
    const verify = within(dialog).getByRole('button', { name: 'Doğrula ve devam et' });
    const callsBeforePress = api.calls.length;
    await userEvent.click(verify);
    // The ceremony started inside the press (the form's submit), before any request.
    expect(atCeremony?.calls).toBe(callsBeforePress);
    expect(['click', 'submit']).toContain(atCeremony?.event);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: STEP_UP_OPTIONS });

    const create = await within(dialog).findByRole('button', { name: 'Passkey oluştur' });
    expect(api.callsTo('POST /passkeys/registration/options').map((c) => c.body)).toEqual([
      { name: 'iPhone', stepUp: signed(challengeId(1)) },
    ]);
    await userEvent.click(create);
    expect(await screen.findByText('Passkey eklendi.')).toBeVisible();
    expect(api.callsTo('POST /passkeys/registration').map((c) => c.body)).toEqual([
      { challengeId: challengeId(50), name: 'iPhone', response: ATTESTATION },
    ]);
    expect(await screen.findByRole('group', { name: 'iPhone' })).toBeVisible();
    // The step-up was used once; no further options were asked for.
    expect(stepUp.issued).toHaveLength(1);
  });

  it('shows the API message and a fresh sign-in link when the first passkey is no longer allowed', async () => {
    const message =
      "Şu anda passkey eklenemez. İlk passkey, Google ile girişten sonraki 10 dakika içinde eklenir: çıkış yapıp yeniden girin ve hemen ekleyin. Sonraki passkey'ler için önce kayıtlı bir passkey ile doğrulama gerekir.";
    securityApi([], {
      'POST /passkeys/registration/options': () => apiError(403, 'passkey_not_allowed', message),
    });
    renderApp(SECURITY_PAGE);
    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'MacBook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(message);
    // The sign-in comes back to this page, where the 10 minutes for the first passkey start.
    expect(within(alert).getByRole('link', { name: 'Yeniden giriş yap' })).toHaveAttribute(
      'href',
      '/api/auth/google?next=%2Fc%2Farmadx%2Fsettings%2Fsecurity',
    );
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('says quietly that creating was cancelled and lets the person press again', async () => {
    const api = securityApi([], {
      'POST /passkeys/registration/options': () =>
        json({ challengeId: challengeId(1), options: REGISTRATION_OPTIONS }),
      'POST /passkeys/registration': () => json(MACBOOK, 201),
    });
    vi.mocked(startRegistration).mockRejectedValueOnce(cancelledByPerson());
    renderApp(SECURITY_PAGE);
    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'MacBook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    const create = await within(dialog).findByRole('button', { name: 'Passkey oluştur' });
    await userEvent.click(create);
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Passkey oluşturma iptal edildi.',
    );
    expect(api.callsTo('POST /passkeys/registration')).toEqual([]);

    // The registration is still open; the second press uses it.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passkey oluştur' }));
    expect(await screen.findByText('Passkey eklendi.')).toBeVisible();
    expect(api.callsTo('POST /passkeys/registration/options')).toHaveLength(1);
  });

  it('says when this device already holds a registered passkey', async () => {
    securityApi([], {
      'POST /passkeys/registration/options': () =>
        json({ challengeId: challengeId(1), options: REGISTRATION_OPTIONS }),
    });
    vi.mocked(startRegistration).mockRejectedValueOnce(
      Object.assign(new Error('The authenticator was previously registered'), {
        name: 'InvalidStateError',
      }),
    );
    renderApp(SECURITY_PAGE);
    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'MacBook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Passkey oluştur' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Bu cihazdaki passkey zaten kayıtlı. Başka bir cihazda passkey ekleyin.',
    );
  });

  it('starts again from the name when the API refuses the registration', async () => {
    const message =
      'Passkey kaydı doğrulanamadı ya da süresi doldu. Passkey eklemeyi yeniden başlatın.';
    securityApi([], {
      'POST /passkeys/registration/options': () =>
        json({ challengeId: challengeId(1), options: REGISTRATION_OPTIONS }),
      'POST /passkeys/registration': () => apiError(403, 'passkey_registration_failed', message),
    });
    renderApp(SECURITY_PAGE);
    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'MacBook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devam' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Passkey oluştur' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    // Back at the name, which is kept.
    expect(within(dialog).getByLabelText('Ad')).toHaveValue('MacBook');
    expect(within(dialog).getByRole('button', { name: 'Devam' })).toBeVisible();
  });
});

describe('settings, security: removing a passkey', () => {
  it('removes a passkey after confirming with a passkey', async () => {
    const stepUp = stepUpIssuer();
    const api = securityApi([MACBOOK, IPHONE], { 'POST /step-up/options': stepUp.handler });
    api.handle(`DELETE /passkeys/${MACBOOK.id}`, () => {
      api.setPasskeys([IPHONE]);
      return noContent();
    });
    renderApp(SECURITY_PAGE);
    const row = await screen.findByRole('group', { name: 'MacBook' });
    await userEvent.click(within(row).getByRole('button', { name: 'Kaldır' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Passkey kaldırılsın mı?' });
    expect(dialog).toHaveTextContent('MacBook ile artık doğrulama yapılamaz.');
    await waitFor(() => {
      expect(stepUp.issued.map((i) => i.body)).toEqual([
        { purpose: 'passkey_revoke', subjectId: MACBOOK.id },
      ]);
    });
    const confirm = within(dialog).getByRole('button', { name: 'Kaldır' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    expect(await screen.findByText('Passkey kaldırıldı.')).toBeVisible();
    expect(api.callsTo(`DELETE /passkeys/${MACBOOK.id}`).map((c) => c.body)).toEqual([
      { stepUp: signed(challengeId(1)) },
    ]);
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'MacBook' })).toBeNull();
    });
    // The row took its button with it; the focus stays in the section.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: "Passkey'ler" })).toHaveFocus();
    });
  });

  it('sends nothing when the person cancels the dialog', async () => {
    const stepUp = stepUpIssuer();
    const api = securityApi([MACBOOK, IPHONE], { 'POST /step-up/options': stepUp.handler });
    renderApp(SECURITY_PAGE);
    const row = await screen.findByRole('group', { name: 'MacBook' });
    const remove = within(row).getByRole('button', { name: 'Kaldır' });
    await userEvent.click(remove);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(`DELETE /passkeys/${MACBOOK.id}`)).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(remove).toHaveFocus();
    });
  });

  it('warns before removing the last passkey', async () => {
    securityApi([MACBOOK], { 'POST /step-up/options': stepUpIssuer().handler });
    renderApp(SECURITY_PAGE);
    const row = await screen.findByRole('group', { name: 'MacBook' });
    await userEvent.click(within(row).getByRole('button', { name: 'Kaldır' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      "MacBook son passkey'iniz. Kaldırırsanız önemli onayları ve üye değişikliklerini yapamazsınız; yeni passkey eklemek için çıkış yapıp yeniden Google ile girmeniz gerekir.",
    );
  });
});

describe('the Bugün screen: a reminder to add the first passkey', () => {
  it('asks a founder without a passkey to add one now, and opens Güvenlik', async () => {
    const api = securityApi([]);
    const { router } = renderApp('/c/armadx');
    const reminder = await screen.findByRole('region', { name: 'Passkey ekleyin' });
    expect(reminder).toHaveTextContent(
      'İlk passkey, Google ile girişten sonraki 10 dakika içinde eklenebilir; şimdi ekleyin.',
    );
    await userEvent.click(within(reminder).getByRole('link', { name: 'Güvenlik sayfasını aç' }));
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(SECURITY_PAGE);
    });
    expect(await screen.findByText('Henüz passkey yok')).toBeVisible();
    expect(api.unexpected).toEqual([]);
  });

  it('is not shown once a passkey exists', async () => {
    const api = securityApi([MACBOOK]);
    renderApp('/c/armadx');
    await screen.findByRole('heading', { level: 1, name: 'Bugün' });
    await waitFor(() => {
      expect(api.callsTo('GET /passkeys')).toHaveLength(1);
    });
    expect(screen.queryByRole('region', { name: 'Passkey ekleyin' })).toBeNull();
  });

  it('is not shown to a person who confirms nothing important, and asks for no list', async () => {
    const api = securityApi([], {
      'GET /session': sessionHandler({ memberships: [EMPLOYEE_MEMBERSHIP] }),
    });
    renderApp('/c/armadx');
    await screen.findByRole('heading', { level: 1, name: 'Bugün' });
    expect(screen.queryByRole('region', { name: 'Passkey ekleyin' })).toBeNull();
    expect(api.callsTo('GET /passkeys')).toEqual([]);
  });

  it('is shown to an employee with the approval right', async () => {
    securityApi([], {
      'GET /session': sessionHandler({
        memberships: [{ ...EMPLOYEE_MEMBERSHIP, canApprove: true }],
      }),
    });
    renderApp('/c/armadx');
    expect(await screen.findByRole('region', { name: 'Passkey ekleyin' })).toBeVisible();
  });
});
