import { describe, expect, it } from 'vitest';
import { ApiError } from './api.ts';
import {
  CeremonyError,
  ceremonyValue,
  noticeFor,
  readPasskeyName,
  settleCeremony,
  STEP_UP_TEXT,
} from './passkeys.ts';

function browserError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

describe('readPasskeyName', () => {
  it('trims the name and refuses an empty, long or hidden-character one in Turkish', () => {
    expect(readPasskeyName('  MacBook  ')).toEqual({ ok: true, name: 'MacBook' });
    expect(readPasskeyName('   ')).toEqual({
      ok: false,
      message: 'Passkey için bir ad yazın, örneğin MacBook.',
    });
    expect(readPasskeyName('x'.repeat(61))).toEqual({
      ok: false,
      message: 'Ad en çok 60 karakter olabilir.',
    });
    expect(readPasskeyName('Mac‮Book')).toEqual({
      ok: false,
      message: 'Ad görünmeyen karakter içeremez. Adı yeniden yazın.',
    });
  });
});

describe('CeremonyError', () => {
  it('tells a cancelled prompt, a known authenticator and other failures apart', () => {
    expect(new CeremonyError(browserError('NotAllowedError')).kind).toBe('cancelled');
    expect(new CeremonyError(browserError('AbortError')).kind).toBe('cancelled');
    expect(new CeremonyError(browserError('InvalidStateError')).kind).toBe('already_registered');
    expect(new CeremonyError(browserError('SecurityError')).kind).toBe('failed');
    expect(new CeremonyError(new Error('WebAuthn is not supported in this browser')).kind).toBe(
      'failed',
    );
    expect(new CeremonyError('not an error').kind).toBe('failed');
  });
});

describe('settleCeremony', () => {
  it('never rejects, and ceremonyValue gives the answer or the CeremonyError', async () => {
    await expect(ceremonyValue(settleCeremony(Promise.resolve('answer')))).resolves.toBe('answer');
    const settled = settleCeremony(Promise.reject(browserError('NotAllowedError')));
    await expect(settled).resolves.toMatchObject({ ok: false });
    await expect(ceremonyValue(settled)).rejects.toBeInstanceOf(CeremonyError);
  });
});

describe('noticeFor', () => {
  it('maps the outcomes to short Turkish messages', () => {
    const cancelled = new CeremonyError(browserError('NotAllowedError'));
    expect(noticeFor(cancelled, 'step_up')).toEqual({
      tone: 'quiet',
      text: 'Doğrulama iptal edildi.',
    });
    expect(noticeFor(cancelled, 'registration')).toEqual({
      tone: 'quiet',
      text: 'Passkey oluşturma iptal edildi.',
    });
    for (const code of ['step_up_failed', 'step_up_required']) {
      expect(noticeFor(new ApiError(403, 'API text', code), 'step_up')).toEqual({
        tone: 'error',
        text: 'Doğrulama başarısız oldu. Yeniden deneyin.',
      });
    }
    expect(noticeFor(new ApiError(409, 'API text', 'no_passkey'), 'step_up')).toEqual({
      tone: 'error',
      text: STEP_UP_TEXT.noPasskey,
      link: 'security',
    });
    expect(
      noticeFor(
        new ApiError(
          403,
          'İlk passkey yalnızca girişten hemen sonra eklenir.',
          'passkey_not_allowed',
        ),
        'registration',
      ),
    ).toEqual({
      tone: 'error',
      text: 'İlk passkey yalnızca girişten hemen sonra eklenir.',
      link: 'sign_in',
    });
    expect(
      noticeFor(new ApiError(409, 'Zaten kayıtlı.', 'passkey_exists'), 'registration'),
    ).toEqual({ tone: 'error', text: 'Zaten kayıtlı.' });
    // A closed session is not shown: the panel opens the login screen.
    expect(noticeFor(new ApiError(401, 'Oturum kapalı.', 'unauthenticated'), 'step_up')).toBeNull();
  });
});
