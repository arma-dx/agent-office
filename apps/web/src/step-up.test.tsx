import type { Member } from '@agent-office/shared';
import { startAuthentication, type AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { focusManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, json, mockApi, sessionHandler, USER_ID } from './test/mock-api.ts';
import {
  ASSERTION,
  cancelledByPerson,
  challengeId,
  signed,
  STEP_UP_OPTIONS,
  stepUpIssuer,
} from './test/passkeys.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The re-verification helper (useStepUp and StepUpDialog), driven through a real consumer: the
// approval toggle on the Kullanıcılar page.

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
const PATCH = `PATCH /members/${EMPLOYEE.userId}`;

function membersApi(handlers: Parameters<typeof mockApi>[0]) {
  return mockApi({
    'GET /session': sessionHandler(),
    'GET /members': () => json({ members: [FOUNDER, EMPLOYEE] }),
    'GET /invitations': () => json({ invitations: [] }),
    [PATCH]: () => json({ ...EMPLOYEE, canApprove: true }),
    ...handlers,
  });
}

/** Opens the confirmation dialog of the approval toggle. */
async function openApprovalDialog() {
  const row = await screen.findByRole('group', { name: 'Ayşe Demir' });
  const toggle = within(row).getByRole('switch', { name: 'Onay yetkisi' });
  await userEvent.click(toggle);
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Ayşe Demir için onay yetkisi açılsın mı?',
  });
  return { dialog, confirm: within(dialog).getByRole('button', { name: 'Yetkiyi aç' }) };
}

async function whenReady(confirm: HTMLElement) {
  await waitFor(() => {
    expect(confirm).not.toHaveAttribute('aria-disabled');
  });
}

// window.event is the event being dispatched; read without the deprecated DOM typing.
function currentEventType(): string | undefined {
  return (globalThis as { event?: Event }).event?.type;
}

describe('step-up: order of the steps', () => {
  it('fetches the options when the dialog opens and starts the ceremony inside the click', async () => {
    const stepUp = stepUpIssuer();
    const api = membersApi({ 'POST /step-up/options': stepUp.handler });
    let atCeremony: { event: string | undefined; calls: number } | undefined;
    vi.mocked(startAuthentication).mockImplementation(() => {
      atCeremony = { event: currentEventType(), calls: api.calls.length };
      return Promise.resolve(ASSERTION);
    });
    renderApp('/c/armadx/settings/users');
    await screen.findByText('Çalışan, onay yetkisi yok, etkin');
    // Nothing is asked before the dialog opens.
    expect(api.callsTo('POST /step-up/options')).toEqual([]);

    const { confirm } = await openApprovalDialog();
    await whenReady(confirm);
    expect(stepUp.issued).toHaveLength(1);
    expect(startAuthentication).not.toHaveBeenCalled();

    const callsBeforeClick = api.calls.length;
    await userEvent.click(confirm);
    // The ceremony started during the click itself, before any other request (Safari's rule).
    expect(atCeremony).toEqual({ event: 'click', calls: callsBeforeClick });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: STEP_UP_OPTIONS });
    await waitFor(() => {
      expect(api.callsTo(PATCH).map((c) => c.body)).toEqual([
        { canApprove: true, stepUp: signed(challengeId(1)) },
      ]);
    });
    // The protected request came after the ceremony, and no new options were fetched.
    expect(api.calls.slice(callsBeforeClick)[0]?.method).toBe('PATCH');
    expect(stepUp.issued).toHaveLength(1);
  });

  it('says it is preparing while the options load, and starts nothing before they come', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = membersApi({
      'POST /step-up/options': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openApprovalDialog();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Doğrulama hazırlanıyor.');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(confirm);
    expect(startAuthentication).not.toHaveBeenCalled();
    // The request already on its way is not sent twice.
    expect(api.callsTo('POST /step-up/options')).toHaveLength(1);

    answer(json({ challengeId: challengeId(7), options: STEP_UP_OPTIONS }));
    await whenReady(confirm);
    expect(within(dialog).getByRole('status')).toBeEmptyDOMElement();
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(api.callsTo(PATCH).map((c) => c.body)).toEqual([
        { canApprove: true, stepUp: signed(challengeId(7)) },
      ]);
    });
  });

  it('starts no ceremony with options older than 4 minutes; it fetches new ones first', async () => {
    const stepUp = stepUpIssuer();
    const api = membersApi({ 'POST /step-up/options': stepUp.handler });
    renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openApprovalDialog();
    await whenReady(confirm);

    // The device slept with the dialog open: the challenge is about to expire on the server.
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60 * 1000);
    try {
      await userEvent.click(confirm);
      expect(startAuthentication).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(stepUp.issued).toHaveLength(2);
      });
      await waitFor(() => {
        expect(within(dialog).getByRole('status')).toBeEmptyDOMElement();
      });
      await userEvent.click(confirm);
      await waitFor(() => {
        expect(api.callsTo(PATCH).map((c) => c.body)).toEqual([
          { canApprove: true, stepUp: signed(challengeId(2)) },
        ]);
      });
    } finally {
      clock.mockRestore();
    }
  });
});

describe('step-up: one challenge at a time', () => {
  it('fetches no new challenge on its own while a ceremony is on its way', async () => {
    // A new challenge closes the open one on the server; one fetched while the person confirms
    // would make the confirmation fail.
    let finish: (response: AuthenticationResponseJSON) => void = () => undefined;
    vi.mocked(startAuthentication).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stepUp = stepUpIssuer();
    const api = membersApi({ 'POST /step-up/options': stepUp.handler });
    renderApp('/c/armadx/settings/users');
    const { confirm } = await openApprovalDialog();
    await whenReady(confirm);
    await userEvent.click(confirm);
    expect(startAuthentication).toHaveBeenCalledTimes(1);

    // The prompt took the window's focus for longer than the 3 minutes after which the options
    // are refreshed; the window gets it back before the answer is sent.
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 3.5 * 60 * 1000);
    try {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(stepUp.issued).toHaveLength(1);

      finish(ASSERTION);
      await waitFor(() => {
        expect(api.callsTo(PATCH).map((c) => c.body)).toEqual([
          { canApprove: true, stepUp: signed(challengeId(1)) },
        ]);
      });
    } finally {
      clock.mockRestore();
      focusManager.setFocused(undefined);
    }
  });
});

describe('step-up: messages', () => {
  it('says quietly that the verification was cancelled, then tries the same challenge again', async () => {
    const stepUp = stepUpIssuer();
    const api = membersApi({ 'POST /step-up/options': stepUp.handler });
    vi.mocked(startAuthentication).mockRejectedValueOnce(cancelledByPerson());
    renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openApprovalDialog();
    await whenReady(confirm);
    await userEvent.click(confirm);

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Doğrulama iptal edildi.');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(api.callsTo(PATCH)).toEqual([]);
    // The API never saw the challenge, so it is still good.
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(api.callsTo(PATCH).map((c) => c.body)).toEqual([
        { canApprove: true, stepUp: signed(challengeId(1)) },
      ]);
    });
    expect(stepUp.issued).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks again with a new challenge when the API refuses the verification', async () => {
    const stepUp = stepUpIssuer();
    let refusals = 1;
    const api = membersApi({
      'POST /step-up/options': stepUp.handler,
      [PATCH]: () => {
        if (refusals > 0) {
          refusals -= 1;
          return apiError(
            403,
            'step_up_failed',
            "Passkey doğrulaması geçmedi ya da süresi doldu. İşlemi yeniden başlatıp passkey'inizle onaylayın.",
          );
        }
        return json({ ...EMPLOYEE, canApprove: true });
      },
    });
    renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openApprovalDialog();
    await whenReady(confirm);
    await userEvent.click(confirm);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Doğrulama başarısız oldu. Yeniden deneyin.',
    );
    // The first challenge is used up on the server; a new one is fetched for the next try.
    await waitFor(() => {
      expect(stepUp.issued).toHaveLength(2);
    });
    await whenReady(confirm);
    await userEvent.click(confirm);
    expect(await screen.findByText('Çalışan, onay yetkisi var, etkin')).toBeVisible();
    expect(api.callsTo(PATCH).map((c) => c.body)).toEqual([
      { canApprove: true, stepUp: signed(challengeId(1)) },
      { canApprove: true, stepUp: signed(challengeId(2)) },
    ]);
  });

  it('points to the Güvenlik page when the person has no passkey', async () => {
    membersApi({
      'GET /passkeys': () => json({ passkeys: [] }),
      'POST /step-up/options': () =>
        apiError(
          409,
          'no_passkey',
          "Kayıtlı passkey'iniz yok. Bu işlem için önce Passkey'ler sayfasından passkey ekleyin.",
        ),
    });
    const { router } = renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openApprovalDialog();
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      "Bu işlem için passkey ile doğrulama gerekiyor ama kayıtlı passkey'iniz yok. Önce Güvenlik sayfasından passkey ekleyin.",
    );
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(startAuthentication).not.toHaveBeenCalled();

    await userEvent.click(within(alert).getByRole('link', { name: 'Güvenlik sayfasını aç' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Güvenlik' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/c/armadx/settings/security');
  });

  it('says when the browser cannot do the verification', async () => {
    const stepUp = stepUpIssuer();
    const api = membersApi({ 'POST /step-up/options': stepUp.handler });
    vi.mocked(startAuthentication).mockRejectedValueOnce(
      Object.assign(new Error('The RP ID is invalid for this domain'), { name: 'SecurityError' }),
    );
    renderApp('/c/armadx/settings/users');
    const { dialog, confirm } = await openApprovalDialog();
    await whenReady(confirm);
    await userEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Passkey ile doğrulama bu tarayıcıda tamamlanamadı. Güncel bir tarayıcıyla ya da başka bir cihazla yeniden deneyin. Passkey'inizi kaybettiyseniz yapılacaklar Güvenlik sayfasında yazıyor.",
    );
    expect(api.callsTo(PATCH)).toEqual([]);
    expect(stepUp.issued).toHaveLength(1);
  });

  it("shows the API's message when too many challenges are open", async () => {
    membersApi({
      'POST /step-up/options': () =>
        apiError(
          429,
          'challenge_limit',
          'Açık doğrulama isteği çok fazla. Birkaç dakika bekleyip yeniden deneyin.',
        ),
    });
    renderApp('/c/armadx/settings/users');
    const { dialog } = await openApprovalDialog();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Açık doğrulama isteği çok fazla. Birkaç dakika bekleyip yeniden deneyin.',
    );
  });
});
