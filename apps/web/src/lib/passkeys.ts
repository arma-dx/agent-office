import {
  passkeyListSchema,
  passkeyNameSchema,
  passkeySchema,
  registrationOptionsRequestSchema,
  registrationOptionsResponseSchema,
  registrationRequestSchema,
  revokePasskeyRequestSchema,
  stepUpOptionsRequestSchema,
  stepUpOptionsResponseSchema,
  type Passkey,
  type RegistrationOptionsResponse,
  type StepUp,
  type StepUpOptionsRequest,
  type StepUpOptionsResponse,
} from '@agent-office/shared';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, apiRequest, isUnauthorized, userMessage } from './api.ts';

/*
 * Passkeys of the signed-in person and the re-verification with a passkey (3 October decision 7).
 * Passkeys belong to the person, not to a company, so these requests carry no company header.
 *
 * Safari lets a page start a WebAuthn ceremony only inside the click (or key press) that asked for
 * it. So the options are fetched before the click (when the dialog opens), and the click handler
 * calls startAuthentication or startRegistration first, before it awaits anything.
 */

export const PASSKEYS_QUERY_KEY = ['passkeys'] as const;

export const passkeysQueryOptions = queryOptions({
  queryKey: PASSKEYS_QUERY_KEY,
  queryFn: async ({ signal }): Promise<Passkey[]> =>
    (await apiRequest('/passkeys', { schema: passkeyListSchema, signal })).passkeys,
});

/**
 * A challenge is valid for 5 minutes on the server. While the dialog stays open the panel replaces
 * it every 3 minutes, and it starts no ceremony with one older than 4 minutes, which leaves the
 * person at least a minute for the prompt.
 */
export const STEP_UP_REFRESH_MS = 3 * 60 * 1000;
export const STEP_UP_MAX_AGE_MS = 4 * 60 * 1000;

/**
 * POST /api/step-up/options for one action, fetched when its dialog opens. Each answer opens a new
 * challenge on the server, so it is not cached beyond the dialog (gcTime 0) and the request is not
 * aborted when the dialog closes (aborting would not undo the challenge).
 */
export function stepUpOptionsQueryOptions(request: StepUpOptionsRequest | null) {
  return queryOptions({
    queryKey: ['step-up-options', request] as const,
    queryFn:
      request === null
        ? skipToken
        : (): Promise<StepUpOptionsResponse> =>
            apiRequest('/step-up/options', {
              method: 'POST',
              body: stepUpOptionsRequestSchema.parse(request),
              schema: stepUpOptionsResponseSchema,
            }),
    staleTime: STEP_UP_REFRESH_MS,
    refetchInterval: STEP_UP_REFRESH_MS,
    gcTime: 0,
  });
}

/**
 * POST /api/passkeys/registration/options. The first passkey goes without stepUp; every further
 * one needs a passkey_add re-verification.
 */
export function startPasskeyRegistration(
  name: string,
  stepUp?: StepUp,
): Promise<RegistrationOptionsResponse> {
  const body = registrationOptionsRequestSchema.parse(
    stepUp === undefined ? { name } : { name, stepUp },
  );
  return apiRequest('/passkeys/registration/options', {
    method: 'POST',
    body,
    schema: registrationOptionsResponseSchema,
  });
}

/**
 * POST /api/passkeys/registration with the browser's answer (startRegistration), checked with the
 * shared schema; `name` is the one the options were made for.
 */
export function finishPasskeyRegistration(request: {
  challengeId: string;
  name: string;
  response: unknown;
}): Promise<Passkey> {
  const body = registrationRequestSchema.parse(request);
  return apiRequest('/passkeys/registration', { method: 'POST', body, schema: passkeySchema });
}

/** DELETE /api/passkeys/:id with a passkey_revoke re-verification naming that passkey. */
export function revokePasskey(passkeyId: string, stepUp: StepUp): Promise<undefined> {
  const id = z.uuid().parse(passkeyId);
  const body = revokePasskeyRequestSchema.parse({ stepUp });
  return apiRequest(`/passkeys/${id}`, { method: 'DELETE', body, schema: z.undefined() });
}

/** The most passkeys a person can have; the API refuses an eleventh (passkey_limit). */
export const MAX_PASSKEYS = 10;

/**
 * Checks a passkey name with the shared schema, synchronously, so that the click that confirms it
 * can still start a ceremony. Returns the trimmed name, or a Turkish message.
 */
export function readPasskeyName(
  value: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const result = passkeyNameSchema.safeParse(value);
  if (result.success) return { ok: true, name: result.data };
  const issue = result.error.issues[0];
  if (issue?.code === 'too_small') {
    return { ok: false, message: 'Passkey için bir ad yazın, örneğin MacBook.' };
  }
  if (issue?.code === 'too_big') return { ok: false, message: 'Ad en çok 60 karakter olabilir.' };
  return { ok: false, message: 'Ad görünmeyen karakter içeremez. Adı yeniden yazın.' };
}

// Ceremonies ------------------------------------------------------------------------------------

/** A WebAuthn ceremony that did not finish, told apart from the API's errors. */
export class CeremonyError extends Error {
  /**
   * cancelled: the person closed the prompt, or it timed out (the browser does not tell these apart);
   * already_registered: this authenticator already holds one of the person's passkeys;
   * failed: the browser cannot do it (no WebAuthn, wrong domain, authenticator error).
   */
  readonly kind: 'cancelled' | 'already_registered' | 'failed';

  constructor(cause: unknown) {
    super('The passkey ceremony did not finish', { cause });
    this.name = 'CeremonyError';
    // A WebAuthnError of the library carries the DOMException's name; a DOMException may come as is.
    const name =
      typeof cause === 'object' && cause !== null && 'name' in cause ? cause.name : undefined;
    this.kind =
      name === 'NotAllowedError' || name === 'AbortError'
        ? 'cancelled'
        : name === 'InvalidStateError'
          ? 'already_registered'
          : 'failed';
  }
}

export type CeremonyResult<T> = { ok: true; value: T } | { ok: false; error: CeremonyError };

/**
 * Wraps a ceremony that the click handler started, for the mutation that awaits it a few ticks
 * later. The wrapped promise never rejects, so a prompt the person cancels at once is never an
 * unhandled rejection.
 */
export function settleCeremony<T>(ceremony: Promise<T>): Promise<CeremonyResult<T>> {
  return ceremony.then(
    (value): CeremonyResult<T> => ({ ok: true, value }),
    (error: unknown): CeremonyResult<T> => ({ ok: false, error: new CeremonyError(error) }),
  );
}

/** The ceremony's answer; throws the CeremonyError when it did not finish. */
export async function ceremonyValue<T>(settled: Promise<CeremonyResult<T>>): Promise<T> {
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

// Messages --------------------------------------------------------------------------------------

/** A short message in a passkey dialog. `quiet` ones are not errors (a cancelled prompt). */
export interface Notice {
  tone: 'quiet' | 'error';
  text: string;
  /** security: a link to the Güvenlik page; sign_in: a link to a fresh Google sign-in. */
  link?: 'security' | 'sign_in';
}

export const STEP_UP_TEXT = {
  hint: 'Onayladığınızda cihazınız parmak izi, yüz tanıma ya da ekran kilidiyle doğrulama ister.',
  preparing: 'Doğrulama hazırlanıyor.',
  notReady: 'Doğrulama henüz hazır değil. Birkaç saniye sonra yeniden deneyin.',
  cancelled: 'Doğrulama iptal edildi.',
  failed: 'Doğrulama başarısız oldu. Yeniden deneyin.',
  noPasskey:
    "Bu işlem için passkey ile doğrulama gerekiyor ama kayıtlı passkey'iniz yok. Önce Güvenlik sayfasından passkey ekleyin.",
  unsupported:
    'Passkey ile doğrulama bu tarayıcıda tamamlanamadı. Güncel bir tarayıcıyla ya da başka bir cihazla yeniden deneyin.',
} as const;

export const REGISTRATION_TEXT = {
  cancelled: 'Passkey oluşturma iptal edildi.',
  alreadyRegistered: 'Bu cihazdaki passkey zaten kayıtlı. Başka bir cihazda passkey ekleyin.',
  unsupported:
    'Passkey bu tarayıcıda oluşturulamadı. Güncel bir tarayıcıyla ya da başka bir cihazla yeniden deneyin.',
} as const;

function hasCode(error: unknown, ...codes: string[]): error is ApiError {
  return error instanceof ApiError && error.code !== undefined && codes.includes(error.code);
}

/**
 * What to show for a failed step of a passkey dialog; null for a closed session (the panel then
 * opens the login screen, which says so).
 */
export function noticeFor(error: unknown, ceremony: 'step_up' | 'registration'): Notice | null {
  if (isUnauthorized(error)) return null;
  if (error instanceof CeremonyError) {
    const text = ceremony === 'step_up' ? STEP_UP_TEXT : REGISTRATION_TEXT;
    if (error.kind === 'cancelled') return { tone: 'quiet', text: text.cancelled };
    if (error.kind === 'already_registered' && ceremony === 'registration') {
      return { tone: 'error', text: REGISTRATION_TEXT.alreadyRegistered };
    }
    return { tone: 'error', text: text.unsupported };
  }
  if (hasCode(error, 'step_up_failed', 'step_up_required')) {
    return { tone: 'error', text: STEP_UP_TEXT.failed };
  }
  if (hasCode(error, 'no_passkey')) {
    return { tone: 'error', text: STEP_UP_TEXT.noPasskey, link: 'security' };
  }
  if (hasCode(error, 'passkey_not_allowed')) {
    return { tone: 'error', text: userMessage(error), link: 'sign_in' };
  }
  return { tone: 'error', text: userMessage(error) };
}
