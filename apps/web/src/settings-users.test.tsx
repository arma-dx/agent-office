import { COMPANY_HEADER, type Invitation, type Member } from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  apiError,
  ARMADX,
  type Handler,
  json,
  mockApi,
  noContent,
  PILLIKA,
  sessionBody,
  sessionHandler,
  USER_ID,
} from './test/mock-api.ts';
import { ASSERTION, challengeId, signed, STEP_UP_OPTIONS, stepUpIssuer } from './test/passkeys.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';
import { formatDateTime } from './lib/users.ts';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
});

const FOUNDER: Member = {
  userId: USER_ID,
  name: 'Ömer Kadıoğlu',
  role: 'founder',
  canApprove: true,
  active: true,
};
const EMPLOYEE: Member = {
  userId: '1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6',
  name: 'Ayşe Demir',
  role: 'employee',
  canApprove: false,
  active: true,
};
const EXTERNAL: Member = {
  userId: '2e3f4a5b-6c7d-4e8f-9a01-b2c3d4e5f6a7',
  name: 'Mali Müşavir',
  role: 'external',
  canApprove: false,
  active: false,
};

// Invitation times are relative to now: what can be done with one depends on its age.
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

const PENDING: Invitation = {
  id: '3f4a5b6c-7d8e-4f90-a112-c3d4e5f6a7b8',
  email: 'yeni@armadx.com',
  role: 'employee',
  canApprove: true,
  createdAt: daysFromNow(-1),
  expiresAt: daysFromNow(6),
  status: 'pending',
};
// Expired, still within 30 days of its creation: its time can be extended.
const EXPIRED: Invitation = {
  id: '4a5b6c7d-8e9f-4a01-b223-d4e5f6a7b8c9',
  email: 'avukat@example.com',
  role: 'external',
  canApprove: false,
  createdAt: daysFromNow(-10),
  expiresAt: daysFromNow(-3),
  status: 'expired',
};
// Expired and older than 30 days: it can only be cancelled, which frees the address.
const PAST_LIMIT: Invitation = {
  id: '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b',
  email: 'eski@example.com',
  role: 'external',
  canApprove: false,
  createdAt: daysFromNow(-40),
  expiresAt: daysFromNow(-10),
  status: 'expired',
};
const ACCEPTED: Invitation = {
  ...PENDING,
  id: '5b6c7d8e-9fa0-4b12-8334-e5f6a7b8c9d0',
  email: 'ayse@armadx.com',
  status: 'accepted',
};

const SECOND_FOUNDER: Member = {
  userId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
  name: 'İkinci Kurucu',
  role: 'founder',
  canApprove: true,
  active: true,
};

const RESET = `POST /members/${EMPLOYEE.userId}/passkeys/reset`;
const RESET_TEXT =
  "Bu kişinin bütün passkey'leri kaldırılır ve açık oturumları kapatılır. Kişi Google ile yeniden girip 10 dakika içinde yeni bir passkey ekler. Cihazı kaybolduysa önce o cihazdaki Google oturumunu kapatmasını ya da Google parolasını değiştirmesini isteyin; yoksa cihazı bulan kişi yeni passkey'i ekleyebilir.";
// The panel sends the person nothing, so the founder is told to tell them.
const RESET_DONE_TEXT =
  "Ayşe Demir için passkey'ler sıfırlandı. Kişiye e-posta gitmez; kendisine haber verin: Google ile yeniden girip 10 dakika içinde Güvenlik sayfasından yeni passkey eklesin.";
// While the confirmation dialog is open the rest of the page is hidden from assistive technology.
const resetResult = () =>
  screen.getByRole('status', { name: 'Passkey sıfırlama sonucu', hidden: true });

const EMPLOYEE_MEMBERSHIP = { ...ARMADX, role: 'employee' as const, canApprove: false };

function founderApi(extra: Record<string, Handler> = {}) {
  return mockApi({
    'GET /session': sessionHandler(),
    'GET /members': () => json({ members: [FOUNDER, EMPLOYEE, EXTERNAL] }),
    'GET /invitations': () => json({ invitations: [PENDING, EXPIRED, PAST_LIMIT, ACCEPTED] }),
    ...extra,
  });
}

function row(name: string) {
  return screen.getByRole('group', { name });
}

async function inviteForm() {
  return within(await screen.findByRole('region', { name: 'Yeni davet' }));
}

describe('settings, users: visibility', () => {
  it('is in the user menu of the founder and opens the users page', async () => {
    founderApi();
    const { router } = renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Kullanıcılar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kullanıcılar' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/c/armadx/settings/users');
    // Settings are in the account menu, not in the sidebar menu.
    const mainMenu = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(mainMenu).queryByRole('link', { name: 'Kullanıcılar' })).toBeNull();
  });

  it('is not offered to an employee', async () => {
    mockApi({ 'GET /session': sessionHandler({ memberships: [EMPLOYEE_MEMBERSHIP] }) });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Kullanıcılar' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Çıkış yap' })).toBeVisible();
  });

  it('answers an employee who opens the address with the 403 message', async () => {
    const api = mockApi({ 'GET /session': sessionHandler({ memberships: [EMPLOYEE_MEMBERSHIP] }) });
    renderApp('/c/armadx/settings/users');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bu işlem için yetkiniz yok. Kullanıcıları ve davetleri kurucu yönetir.',
    );
    expect(api.callsTo('GET /members')).toEqual([]);
    expect(api.callsTo('GET /invitations')).toEqual([]);
  });

  it('is not offered in the private space', async () => {
    founderApi();
    renderApp('/c/founder_space');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Kullanıcılar' })).toBeNull();
  });
});

describe('settings, users: members', () => {
  it('lists members with Turkish roles, approval rights and state', async () => {
    founderApi();
    renderApp('/c/armadx/settings/users');
    expect(await screen.findByText('Kurucu, onay yetkisi var, etkin')).toBeVisible();
    expect(screen.getByText('Çalışan, onay yetkisi yok, etkin')).toBeVisible();
    expect(screen.getByText('Dış kişi, onay yetkisi yok, devre dışı')).toBeVisible();
    // The founder's own row cannot be edited from the panel.
    expect(within(row('Ömer Kadıoğlu')).queryByRole('combobox')).toBeNull();
    expect(within(row('Ömer Kadıoğlu')).queryByRole('button')).toBeNull();
    // The approval toggle is only for employees.
    expect(within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' })).toBeVisible();
    expect(within(row('Mali Müşavir')).queryByRole('switch')).toBeNull();
  });

  it('changes the role after a passkey confirmation; approval rights go with a change to external', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      [`PATCH /members/${EMPLOYEE.userId}`]: () => json({ ...EMPLOYEE, role: 'external' }),
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    const select = within(row('Ayşe Demir')).getByRole('combobox', { name: 'Rol' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Çalışan', 'Dış kişi']);
    await userEvent.selectOptions(select, 'external');

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Demir dış kişi olsun mu?',
    });
    // The confirmation says what the change takes away: the person's project memberships in this
    // company go with the role and do not come back.
    expect(dialog).toHaveTextContent(
      'Dış kişi yalnızca kendisine açılan görev ve notları görür. Bu şirketteki proje üyelikleri kalkar; üyelikler geri gelmez.',
    );
    // Nothing changes before the confirmation; the control keeps the saved value.
    expect(select).toHaveValue('employee');
    expect(api.callsTo(`PATCH /members/${EMPLOYEE.userId}`)).toEqual([]);
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    // The re-verification names this company, this member and exactly this change.
    expect(stepUp.issued[0]?.body).toEqual({
      purpose: 'membership_change',
      companyId: ARMADX.companyId,
      subjectId: EMPLOYEE.userId,
      details: { action: 'update', role: 'external', canApprove: false },
    });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Rolü değiştir' }));
    expect(await screen.findByText('Dış kişi, onay yetkisi yok, etkin')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const [call] = api.callsTo(`PATCH /members/${EMPLOYEE.userId}`);
    expect(call?.body).toEqual({
      role: 'external',
      canApprove: false,
      stepUp: signed(challengeId(1)),
    });
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: STEP_UP_OPTIONS });
    // The dialog had no trigger of its own; the focus goes back to the control.
    await waitFor(() => {
      expect(within(row('Ayşe Demir')).getByRole('combobox', { name: 'Rol' })).toHaveFocus();
    });
  });

  it('says that the approval right goes too when a member who has it becomes external', async () => {
    founderApi({
      'GET /members': () => json({ members: [FOUNDER, { ...EMPLOYEE, canApprove: true }] }),
      'POST /step-up/options': stepUpIssuer().handler,
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi var, etkin');
    await userEvent.selectOptions(
      within(row('Ayşe Demir')).getByRole('combobox', { name: 'Rol' }),
      'external',
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Demir dış kişi olsun mu?',
    });
    expect(dialog).toHaveTextContent(
      'Dış kişi yalnızca kendisine açılan görev ve notları görür. Onay yetkisi ve bu şirketteki proje üyelikleri kalkar; üyelikler geri gelmez.',
    );
  });

  it('Kullanıcılar: removing a member and making a person external say that their open requests go on in the founder’s name', async () => {
    // 8 October decision 45 was asked for exactly these two acts, and only the founder does
    // them: the confirmation says it before a stranger's result waits for the founder.
    const GO_ON = ' Açık talepleri sürer: ajan kurucunun adına çalışır, sonucu kurucu onaylar.';
    const HOLDER = {
      ...EMPLOYEE,
      userId: '77777777-7777-4777-8777-777777777777',
      name: 'Can Öz',
      canApprove: true,
    };
    founderApi({
      'GET /members': () => json({ members: [FOUNDER, EMPLOYEE, HOLDER, EXTERNAL] }),
      'POST /step-up/options': stepUpIssuer().handler,
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    const giveUp = async (dialog: HTMLElement) => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
    };

    await userEvent.click(
      within(row('Ayşe Demir')).getByRole('button', { name: 'Üyelikten çıkar' }),
    );
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Demir üyelikten çıkarılsın mı?',
    });
    expect(
      within(dialog).getByText(
        `Bu şirketin paneline ve kayıtlarına artık erişemez. Gerekirse yeniden davet edebilirsiniz.${GO_ON}`,
      ),
    ).toBeVisible();
    await giveUp(dialog);

    // Made an external person: without and with the approval right.
    await userEvent.selectOptions(
      within(row('Ayşe Demir')).getByRole('combobox', { name: 'Rol' }),
      'external',
    );
    dialog = await screen.findByRole('alertdialog', { name: 'Ayşe Demir dış kişi olsun mu?' });
    expect(
      within(dialog).getByText(
        `Dış kişi yalnızca kendisine açılan görev ve notları görür. Bu şirketteki proje üyelikleri kalkar; üyelikler geri gelmez.${GO_ON}`,
      ),
    ).toBeVisible();
    await giveUp(dialog);
    await userEvent.selectOptions(
      within(row('Can Öz')).getByRole('combobox', { name: 'Rol' }),
      'external',
    );
    dialog = await screen.findByRole('alertdialog', { name: 'Can Öz dış kişi olsun mu?' });
    expect(
      within(dialog).getByText(
        `Dış kişi yalnızca kendisine açılan görev ve notları görür. Onay yetkisi ve bu şirketteki proje üyelikleri kalkar; üyelikler geri gelmez.${GO_ON}`,
      ),
    ).toBeVisible();
    await giveUp(dialog);

    // The acts that take no request from anybody do not say it: an approval right, and an
    // external person who becomes an employee.
    await userEvent.click(within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' }));
    dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Demir için onay yetkisi açılsın mı?',
    });
    expect(dialog).not.toHaveTextContent(/Açık talepleri|kurucunun adına/);
    await giveUp(dialog);
    await userEvent.selectOptions(
      within(row(EXTERNAL.name)).getByRole('combobox', { name: 'Rol' }),
      'employee',
    );
    dialog = await screen.findByRole('alertdialog', {
      name: `${EXTERNAL.name} çalışan olsun mu?`,
    });
    expect(dialog).not.toHaveTextContent(/Açık talepleri|kurucunun adına/);
  });

  it('turns approval rights on for an employee after a passkey confirmation', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      [`PATCH /members/${EMPLOYEE.userId}`]: () => json({ ...EMPLOYEE, canApprove: true }),
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    const toggle = within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' });
    await userEvent.click(toggle);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Demir için onay yetkisi açılsın mı?',
    });
    expect(toggle).not.toBeChecked();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Yetkiyi aç' }));
    expect(await screen.findByText('Çalışan, onay yetkisi var, etkin')).toBeVisible();
    expect(stepUp.issued.map((i) => i.body)).toEqual([
      {
        purpose: 'membership_change',
        companyId: ARMADX.companyId,
        subjectId: EMPLOYEE.userId,
        details: { action: 'update', canApprove: true },
      },
    ]);
    expect(api.callsTo(`PATCH /members/${EMPLOYEE.userId}`).map((c) => c.body)).toEqual([
      { canApprove: true, stepUp: signed(challengeId(1)) },
    ]);
    await waitFor(() => {
      expect(within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' })).toHaveFocus();
    });
  });

  it('removes a member only after a passkey confirmation', async () => {
    let members = [FOUNDER, EMPLOYEE, EXTERNAL];
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'GET /members': () => json({ members }),
      'POST /step-up/options': stepUp.handler,
      [`DELETE /members/${EMPLOYEE.userId}`]: () => {
        members = members.filter((m) => m.userId !== EMPLOYEE.userId);
        return noContent();
      },
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');

    await userEvent.click(
      within(row('Ayşe Demir')).getByRole('button', { name: 'Üyelikten çıkar' }),
    );
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Ayşe Demir üyelikten çıkarılsın mı?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(`DELETE /members/${EMPLOYEE.userId}`)).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();

    await userEvent.click(
      within(row('Ayşe Demir')).getByRole('button', { name: 'Üyelikten çıkar' }),
    );
    dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Üyelikten çıkar' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    expect(await screen.findByText('Ayşe Demir üyelikten çıkarıldı.')).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Ayşe Demir' })).toBeNull();
    });
    const removal = stepUp.issued.at(-1);
    expect(removal?.body).toEqual({
      purpose: 'membership_change',
      companyId: ARMADX.companyId,
      subjectId: EMPLOYEE.userId,
      details: { action: 'remove' },
    });
    const calls = api.callsTo(`DELETE /members/${EMPLOYEE.userId}`);
    expect(calls.map((c) => c.body)).toEqual([{ stepUp: signed(removal!.challengeId) }]);
    expect(calls[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    // The removed row took its button with it; the keyboard focus stays in the list's section.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Üyeler' })).toHaveFocus();
    });
  });

  it('keeps the dialog open and sends nothing more while the change is on the way', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      // The answer never comes: the dialog stays busy.
      [`PATCH /members/${EMPLOYEE.userId}`]: () => new Promise<Response>(() => undefined),
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    await userEvent.click(within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Yetkiyi aç' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(api.callsTo(`PATCH /members/${EMPLOYEE.userId}`)).toHaveLength(1);
    });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    // While busy, more presses send nothing and the dialog does not close.
    await userEvent.click(confirm);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(startAuthentication).toHaveBeenCalledTimes(1);
    expect(api.callsTo(`PATCH /members/${EMPLOYEE.userId}`)).toHaveLength(1);
  });

  it('sends the person to the login screen when a change finds the session closed', async () => {
    let signedIn = true;
    const unauthenticated = () =>
      apiError(401, 'unauthenticated', 'Oturumunuz kapalı. Yeniden giriş yapın.');
    founderApi({
      'GET /session': () => (signedIn ? json(sessionBody()) : unauthenticated()),
      'POST /step-up/options': stepUpIssuer().handler,
      [`PATCH /members/${EMPLOYEE.userId}`]: () => {
        // The session closed on the server (30 minutes idle) before this change.
        signedIn = false;
        return unauthenticated();
      },
    });
    const { router } = renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    await userEvent.click(within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Yetkiyi aç' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({
        pathname: '/login',
        search: { status: 'expired' },
      });
    });
  });

  it('fetches the session again when the founder role is gone, and updates page and menu', async () => {
    let membership = ARMADX;
    const api = founderApi({
      'GET /session': () => json(sessionBody({ memberships: [membership] })),
      'GET /members': () => {
        // Another founder session changed this person's role after the panel loaded.
        membership = EMPLOYEE_MEMBERSHIP;
        return apiError(403, 'founder_only', 'Bu işlemi yalnızca şirketin kurucusu yapabilir.');
      },
    });
    renderApp('/c/armadx/settings/users');
    expect(
      await screen.findByText(
        'Bu işlem için yetkiniz yok. Kullanıcıları ve davetleri kurucu yönetir.',
      ),
    ).toBeVisible();
    expect(api.callsTo('GET /session').length).toBeGreaterThan(1);
    await userEvent.click(screen.getByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Kullanıcılar' })).toBeNull();
  });

  it("shows the API's message in the dialog when a change is refused", async () => {
    founderApi({
      'POST /step-up/options': stepUpIssuer().handler,
      [`PATCH /members/${EMPLOYEE.userId}`]: () =>
        apiError(400, 'approval_only_employee', 'Onay yetkisi yalnızca çalışana verilebilir.'),
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    await userEvent.click(within(row('Ayşe Demir')).getByRole('switch', { name: 'Onay yetkisi' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Yetkiyi aç' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Onay yetkisi yalnızca çalışana verilebilir.',
    );
    expect(screen.getByText('Çalışan, onay yetkisi yok, etkin')).toBeVisible();
  });
});

describe('settings, users: passkey reset', () => {
  /** Opens the reset confirmation of Ayşe Demir. */
  async function openResetDialog() {
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    const trigger = within(row('Ayşe Demir')).getByRole('button', {
      name: "Passkey'leri sıfırla",
    });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('alertdialog', {
      name: "Ayşe Demir için passkey'ler sıfırlansın mı?",
    });
    const confirm = within(dialog).getByRole('button', { name: "Passkey'leri sıfırla" });
    return { trigger, dialog, confirm };
  }

  it('is offered for employees and external persons, never for a founder', async () => {
    founderApi({
      'GET /members': () => json({ members: [FOUNDER, SECOND_FOUNDER, EMPLOYEE, EXTERNAL] }),
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    for (const name of ['Ayşe Demir', 'Mali Müşavir']) {
      expect(within(row(name)).getByRole('button', { name: "Passkey'leri sıfırla" })).toBeVisible();
    }
    // Neither the signed-in founder nor another founder: a founder's passkeys are reset by the
    // database administrator.
    for (const name of ['Ömer Kadıoğlu', 'İkinci Kurucu']) {
      expect(within(row(name)).queryByRole('button', { name: "Passkey'leri sıfırla" })).toBeNull();
    }
  });

  it("is not offered in the signed-in person's own row", async () => {
    // The list answers with the signed-in person as an employee (their role changed meanwhile).
    founderApi({
      'GET /members': () =>
        json({ members: [{ ...FOUNDER, role: 'employee', canApprove: false }, EMPLOYEE] }),
    });
    renderApp('/c/armadx/settings/users');
    await screen.findAllByText('Çalışan, onay yetkisi yok, etkin');
    const own = within(row('Ömer Kadıoğlu'));
    expect(own.getByRole('button', { name: 'Üyelikten çıkar' })).toBeVisible();
    expect(own.queryByRole('button', { name: "Passkey'leri sıfırla" })).toBeNull();
    expect(
      within(row('Ayşe Demir')).getByRole('button', { name: "Passkey'leri sıfırla" }),
    ).toBeVisible();
  });

  it('resets the passkeys of a member after a passkey confirmation', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      [RESET]: () => noContent(),
    });
    renderApp('/c/armadx/settings/users');
    const { trigger, dialog, confirm } = await openResetDialog();
    // The dialog says what happens to the person, and what to do first when the device is lost.
    expect(dialog).toHaveTextContent(RESET_TEXT);
    // Nothing is sent before the confirmation, and nothing is reported.
    expect(api.callsTo(RESET)).toEqual([]);
    expect(resetResult()).toBeEmptyDOMElement();
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    // The re-verification names this company and this person.
    expect(stepUp.issued[0]?.body).toEqual({
      purpose: 'passkey_reset',
      companyId: ARMADX.companyId,
      subjectId: EMPLOYEE.userId,
    });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);

    // The result stays on the page and tells the founder to tell the person.
    await waitFor(() => {
      expect(resetResult()).toHaveTextContent(RESET_DONE_TEXT);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const calls = api.callsTo(RESET);
    expect(calls.map((c) => c.body)).toEqual([{ stepUp: signed(challengeId(1)) }]);
    expect(calls[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: STEP_UP_OPTIONS });
    // The person stays a member; the row and its button are still there and take the focus back.
    expect(screen.getByText('Çalışan, onay yetkisi yok, etkin')).toBeVisible();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(api.unexpected).toEqual([]);
  });

  it('sends nothing when the reset is not confirmed', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({ 'POST /step-up/options': stepUp.handler, [RESET]: () => noContent() });
    renderApp('/c/armadx/settings/users');
    const { dialog } = await openResetDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(RESET)).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(resetResult()).toBeEmptyDOMElement();
  });

  it("shows the API's message in the dialog when the reset is refused", async () => {
    const message =
      "Bu kişinin passkey'leri panelden sıfırlanamaz. Sıfırlama için veritabanı yöneticisine başvurun.";
    const api = founderApi({
      'POST /step-up/options': stepUpIssuer().handler,
      [RESET]: () => apiError(409, 'passkey_reset_not_allowed', message),
    });
    renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openResetDialog();
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(api.callsTo(RESET)).toHaveLength(1);
    expect(resetResult()).toBeEmptyDOMElement();
  });
});

describe('settings, users: invitations', () => {
  it('lists invitations with their Turkish status, end time and the actions that fit', async () => {
    founderApi();
    renderApp('/c/armadx/settings/users');
    const pending = await screen.findByRole('group', { name: 'yeni@armadx.com' });
    expect(pending).toHaveTextContent('Bekliyor');
    expect(pending).toHaveTextContent('Çalışan, onay yetkisi var');
    // An invitation ends at the hour it was created, so the time is shown with the day.
    expect(pending).toHaveTextContent(`Geçerlilik sonu: ${formatDateTime(PENDING.expiresAt)}`);
    expect(within(pending).getByRole('button', { name: 'Süreyi uzat' })).toBeVisible();
    expect(within(pending).getByRole('button', { name: 'İptal et' })).toBeVisible();

    // An expired invitation still holds its address, so it can be cancelled as well.
    const expired = row('avukat@example.com');
    expect(expired).toHaveTextContent('Süresi doldu');
    expect(expired).toHaveTextContent('Dış kişi');
    expect(within(expired).getByRole('button', { name: 'Süreyi uzat' })).toBeVisible();
    expect(within(expired).getByRole('button', { name: 'İptal et' })).toBeVisible();

    // Past the 30-day limit its time cannot be extended; cancelling is the way out.
    const pastLimit = row('eski@example.com');
    expect(pastLimit).toHaveTextContent('Süresi doldu');
    expect(within(pastLimit).queryByRole('button', { name: 'Süreyi uzat' })).toBeNull();
    expect(within(pastLimit).getByRole('button', { name: 'İptal et' })).toBeVisible();

    const accepted = row('ayse@armadx.com');
    expect(accepted).toHaveTextContent('Kabul edildi');
    expect(within(accepted).queryByRole('button')).toBeNull();
  });

  it('extends the time of an invitation after a passkey confirmation, and cancels one without', async () => {
    const extendedTo = daysFromNow(7);
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      [`POST /invitations/${EXPIRED.id}/renew`]: () =>
        json({ ...EXPIRED, status: 'pending', expiresAt: extendedTo }),
      [`POST /invitations/${PENDING.id}/cancel`]: () => noContent(),
    });
    renderApp('/c/armadx/settings/users');
    const expired = await screen.findByRole('group', { name: 'avukat@example.com' });
    const extend = within(expired).getByRole('button', { name: 'Süreyi uzat' });
    await userEvent.click(extend);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Davetin süresi uzatılsın mı?',
    });
    expect(dialog).toHaveTextContent('avukat@example.com için davet 7 gün daha geçerli olur');
    expect(api.callsTo(`POST /invitations/${EXPIRED.id}/renew`)).toEqual([]);
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    // The re-verification names this company, this invitation and the renewal.
    expect(stepUp.issued[0]?.body).toEqual({
      purpose: 'invitation',
      companyId: ARMADX.companyId,
      subjectId: EXPIRED.id,
      details: { action: 'renew' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Süreyi uzat' }));
    expect(
      await screen.findByText(
        `Davetin süresi uzatıldı. Geçerlilik sonu: ${formatDateTime(extendedTo)}.`,
      ),
    ).toBeVisible();
    expect(row('avukat@example.com')).toHaveTextContent('Bekliyor');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(`POST /invitations/${EXPIRED.id}/renew`).map((c) => c.body)).toEqual([
      { stepUp: signed(challengeId(1)) },
    ]);
    await waitFor(() => {
      expect(
        within(row('avukat@example.com')).getByRole('button', { name: 'Süreyi uzat' }),
      ).toHaveFocus();
    });

    // Cancelling takes access away: no passkey.
    await userEvent.click(within(row('yeni@armadx.com')).getByRole('button', { name: 'İptal et' }));
    expect(await screen.findByText('Davet iptal edildi.')).toBeVisible();
    expect(api.callsTo(`POST /invitations/${PENDING.id}/cancel`)).toHaveLength(1);
    expect(stepUp.issued).toHaveLength(1);
  });

  it('closes the renewal without a change when it is not confirmed', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({ 'POST /step-up/options': stepUp.handler });
    renderApp('/c/armadx/settings/users');
    const expired = await screen.findByRole('group', { name: 'avukat@example.com' });
    await userEvent.click(within(expired).getByRole('button', { name: 'Süreyi uzat' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Davetin süresi uzatılsın mı?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(row('avukat@example.com')).toHaveTextContent('Süresi doldu');
    expect(api.callsTo(`POST /invitations/${EXPIRED.id}/renew`)).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('cancels an invitation past the 30-day limit so the address can be invited again', async () => {
    let pastLimit = PAST_LIMIT;
    const api = founderApi({
      'GET /invitations': () => json({ invitations: [PENDING, pastLimit] }),
      [`POST /invitations/${PAST_LIMIT.id}/cancel`]: () => {
        pastLimit = { ...PAST_LIMIT, status: 'cancelled' };
        return noContent();
      },
    });
    renderApp('/c/armadx/settings/users');
    const group = await screen.findByRole('group', { name: 'eski@example.com' });
    await userEvent.click(within(group).getByRole('button', { name: 'İptal et' }));
    await waitFor(() => {
      expect(row('eski@example.com')).toHaveTextContent('İptal edildi');
    });
    expect(within(row('eski@example.com')).queryByRole('button')).toBeNull();
    expect(api.callsTo(`POST /invitations/${PAST_LIMIT.id}/cancel`)).toHaveLength(1);
    // The row's buttons are gone; the keyboard focus stays in the list's section.
    expect(screen.getByRole('heading', { level: 2, name: 'Davetler' })).toHaveFocus();
  });

  it('shows the first step when there is no invitation', async () => {
    founderApi({ 'GET /invitations': () => json({ invitations: [] }) });
    renderApp('/c/armadx/settings/users');
    expect(await screen.findByText('Henüz davet yok')).toBeVisible();
  });
});

describe('settings, users: invite form', () => {
  it('checks the address in Turkish and sends nothing while it is wrong', async () => {
    const api = founderApi();
    renderApp('/c/armadx/settings/users');
    const submit = await screen.findByRole('button', { name: 'Davet oluştur' });
    await userEvent.click(submit);
    expect(await screen.findByText('E-posta adresini yazın.')).toBeVisible();
    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse.armadx.com');
    await userEvent.click(submit);
    expect(
      await screen.findByText('Geçerli bir e-posta adresi yazın, örneğin ad@sirket.com.'),
    ).toBeVisible();
    expect(screen.getByLabelText('E-posta')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST /invitations')).toEqual([]);
  });

  it('creates an invitation after a passkey confirmation and says it is not emailed', async () => {
    const created: Invitation = {
      ...PENDING,
      id: '6c7d8e9f-a0b1-4c23-9445-f6a7b8c9d0e1',
      email: 'ali@armadx.com',
      canApprove: true,
    };
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      'POST /invitations': () => json(created, 201),
    });
    renderApp('/c/armadx/settings/users');
    const form = await inviteForm();
    await userEvent.type(form.getByLabelText('E-posta'), '  Ali@ArmaDX.com ');
    await userEvent.click(form.getByRole('switch', { name: 'Onay yetkisi' }));
    await userEvent.click(form.getByRole('button', { name: 'Davet oluştur' }));

    // Nothing is sent before the confirmation.
    const dialog = await screen.findByRole('alertdialog', { name: 'Davet oluşturulsun mu?' });
    expect(dialog).toHaveTextContent(
      'ali@armadx.com adresi çalışan olarak, onay yetkisiyle davet edilir.',
    );
    expect(api.callsTo('POST /invitations')).toEqual([]);
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(1);
    });
    // The re-verification names this company, the new invitation's id and exactly these fields.
    const options = z
      .object({ subjectId: z.uuid({ version: 'v4' }) })
      .loose()
      .parse(stepUp.issued[0]?.body);
    expect(stepUp.issued[0]?.body).toEqual({
      purpose: 'invitation',
      companyId: ARMADX.companyId,
      subjectId: options.subjectId,
      details: { action: 'create', email: 'ali@armadx.com', role: 'employee', canApprove: true },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Davet oluştur' }));

    const note = await screen.findByText(
      'Davet oluşturuldu ama e-postayla gönderilmez. Kişiye panel adresini iletin ve bu e-posta adresiyle Google ile girmesini söyleyin.',
    );
    expect(note).toBeVisible();
    const result = screen.getByRole('status', { name: 'Davet sonucu' });
    expect(result).toContainElement(note);
    expect(result).toHaveTextContent('ali@armadx.com');
    expect(result).toHaveTextContent(`Geçerlilik sonu${formatDateTime(created.expiresAt)}`);
    const [call] = api.callsTo('POST /invitations');
    expect(call?.body).toEqual({
      id: options.subjectId,
      email: 'ali@armadx.com',
      role: 'employee',
      canApprove: true,
      stepUp: signed(challengeId(1)),
    });
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The form is ready for the next invitation; the list is fetched again.
    expect(screen.getByLabelText('E-posta')).toHaveValue('');
    await waitFor(() => {
      expect(api.callsTo('GET /invitations').length).toBeGreaterThan(1);
    });
  });

  it('invites an external person without approval rights', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      'POST /invitations': () => json({ ...EXPIRED, status: 'pending' }, 201),
    });
    renderApp('/c/armadx/settings/users');
    const form = await inviteForm();
    await userEvent.type(form.getByLabelText('E-posta'), 'avukat@example.com');
    await userEvent.click(form.getByRole('switch', { name: 'Onay yetkisi' }));
    await userEvent.selectOptions(form.getByRole('combobox', { name: 'Rol' }), 'external');
    expect(form.queryByRole('switch', { name: 'Onay yetkisi' })).toBeNull();
    expect(form.getByRole('combobox', { name: 'Rol' })).toHaveAccessibleDescription(
      'Dış kişi yalnızca kendisine açılan görev ve notları görür.',
    );
    await userEvent.click(form.getByRole('button', { name: 'Davet oluştur' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Davet oluşturulsun mu?' });
    expect(dialog).toHaveTextContent('avukat@example.com adresi dış kişi olarak davet edilir.');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Davet oluştur' }));
    await screen.findByText(/^Davet oluşturuldu/);
    expect(stepUp.issued.map((i) => (i.body as { details: unknown }).details)).toEqual([
      { action: 'create', email: 'avukat@example.com', role: 'external', canApprove: false },
    ]);
    expect(api.callsTo('POST /invitations').map((c) => c.body)).toEqual([
      {
        id: (stepUp.issued[0]?.body as { subjectId: string }).subjectId,
        email: 'avukat@example.com',
        role: 'external',
        canApprove: false,
        stepUp: signed(challengeId(1)),
      },
    ]);
  });

  it('sends no invitation when the confirmation is cancelled; the next try gets a new id', async () => {
    const stepUp = stepUpIssuer();
    const api = founderApi({
      'POST /step-up/options': stepUp.handler,
      'POST /invitations': () => json({ ...PENDING, email: 'ali@armadx.com' }, 201),
    });
    renderApp('/c/armadx/settings/users');
    const form = await inviteForm();
    await userEvent.type(form.getByLabelText('E-posta'), 'ali@armadx.com');
    const submit = form.getByRole('button', { name: 'Davet oluştur' });
    await userEvent.click(submit);
    const dialog = await screen.findByRole('alertdialog', { name: 'Davet oluşturulsun mu?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo('POST /invitations')).toEqual([]);
    expect(startAuthentication).not.toHaveBeenCalled();
    // The address stays in the form, and the focus goes back to its button.
    expect(form.getByLabelText('E-posta')).toHaveValue('ali@armadx.com');
    await waitFor(() => {
      expect(submit).toHaveFocus();
    });

    await userEvent.click(submit);
    await screen.findByRole('alertdialog', { name: 'Davet oluşturulsun mu?' });
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(2);
    });
    const subjects = stepUp.issued.map((i) => (i.body as { subjectId: string }).subjectId);
    expect(subjects[0]).not.toBe(subjects[1]);
  });

  async function confirmInvitation(email: string) {
    await userEvent.type(await screen.findByLabelText('E-posta'), email);
    await userEvent.click(screen.getByRole('button', { name: 'Davet oluştur' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Davet oluşturulsun mu?' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Davet oluştur' }));
    return dialog;
  }

  it("shows the API's message in the confirmation when an open invitation exists", async () => {
    const message =
      'Bu adrese kabul edilmemiş bir davet zaten var; süresi dolmuş olabilir. Davetler listesinden süresini uzatın ya da daveti iptal edip yeniden oluşturun.';
    founderApi({
      'POST /step-up/options': stepUpIssuer().handler,
      'POST /invitations': () => apiError(409, 'invitation_exists', message),
    });
    renderApp('/c/armadx/settings/users');
    const dialog = await confirmInvitation('avukat@example.com');
    expect(await within(dialog).findByText(message)).toBeVisible();
    expect(screen.queryByText(/^Davet oluşturuldu/)).toBeNull();
  });

  it('uses the same words as the list when the 409 has no agreed body', async () => {
    founderApi({
      'POST /step-up/options': stepUpIssuer().handler,
      'POST /invitations': () => new Response('Conflict', { status: 409 }),
    });
    renderApp('/c/armadx/settings/users');
    const dialog = await confirmInvitation('avukat@example.com');
    const alert = await within(dialog).findByText(/^Bu adrese kabul edilmemiş bir davet zaten var/);
    // The list offers "Süreyi uzat" and "İptal et"; the message names those actions.
    expect(alert).toHaveTextContent(/süresini uzatın/);
    expect(alert).not.toHaveTextContent(/yenile/i);
  });

  it('keeps the result region in the page, the dialog open while sending, then the focus on the button', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = founderApi({
      'POST /step-up/options': stepUpIssuer().handler,
      'POST /invitations': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp('/c/armadx/settings/users');
    // The live region exists before anything is announced in it.
    const result = await screen.findByRole('status', { name: 'Davet sonucu' });
    expect(result).toBeEmptyDOMElement();
    const form = await inviteForm();
    await userEvent.type(form.getByLabelText('E-posta'), 'ali@armadx.com');
    const submit = form.getByRole('button', { name: 'Davet oluştur' });
    await userEvent.click(submit);
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    const dialog = await screen.findByRole('alertdialog', { name: 'Davet oluşturulsun mu?' });
    const confirm = await within(dialog).findByRole('button', { name: 'Davet oluştur' });
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('aria-disabled');
    });
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(api.callsTo('POST /invitations')).toHaveLength(1);
    });
    // A second press while sending sends nothing.
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(confirm);
    expect(api.callsTo('POST /invitations')).toHaveLength(1);
    answer(json({ ...PENDING, email: 'ali@armadx.com' }, 201));
    expect(await within(result).findByText(/^Davet oluşturuldu/)).toBeVisible();
    expect(screen.getByRole('status', { name: 'Davet sonucu' })).toBe(result);
    await waitFor(() => {
      expect(form.getByRole('button', { name: 'Davet oluştur' })).toHaveFocus();
    });
  });

  it('starts empty in another company', async () => {
    founderApi({ 'PUT /session/company': () => noContent() });
    renderApp('/c/armadx/settings/users');
    await userEvent.type(await screen.findByLabelText('E-posta'), 'yarim@armadx.com');
    await userEvent.click(screen.getByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: PILLIKA.name }));
    await screen.findByRole('button', { name: /Şirket: Pillika/ });
    expect(await screen.findByLabelText('E-posta')).toHaveValue('');
  });
});
