import { randomBytes, randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  passkeyListSchema,
  passkeySchema,
  type Passkey,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newSessionKey } from '../src/session.ts';
import { SoftwareAuthenticator, type Spoil } from './authenticator.ts';
import { accounts, ids } from './fixtures.ts';
import {
  PANEL_ORIGIN,
  SESSION_COOKIE,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';
import {
  addPasskey,
  challengeState,
  errorCode,
  registrationOptions,
  send,
  signStepUp,
  stepUpOptions,
} from './passkey-helpers.ts';

// Passkeys and re-verification through the API (3 October decision 7). A software authenticator
// signs real WebAuthn responses, so the API's verification runs as in production. The tests of
// this file build on each other in order: the holder's two passkeys are added first and removed
// last.

const RP_ID = new URL(PANEL_ORIGIN).hostname;
const EVIL_ORIGIN = 'https://evil.example.test';

/** A session of the person opened the given number of minutes ago (an older Google sign-in). */
async function sessionStartedMinutesAgo(userId: string, minutes: number): Promise<string> {
  const { key, keyHash } = newSessionKey();
  await adminQuery(
    `insert into office.sessions (key_hash, user_id, created_at, last_seen_at, absolute_expires_at)
     values ($1, $2, now() - make_interval(mins => $3), now(),
       now() - make_interval(mins => $3) + interval '8 hours')`,
    [keyHash, userId, minutes],
  );
  return key;
}

describe.skipIf(noDatabase)('passkeys', () => {
  let server: TestServer;
  const newcomerKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  const holderKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  let holder: string;
  // The holder's passkeys (id: the API's reference) and their credential ids.
  let first: Passkey;
  let second: Passkey;
  let firstCredential: string;
  let secondCredential: string;

  beforeAll(async () => {
    server = createTestServer();
    holder = await sessionOf(server, accounts.holder);
  });
  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  async function list(session: string): Promise<Passkey[]> {
    const res = await send(server, session, 'GET', '/api/passkeys');
    expect(res.statusCode).toBe(200);
    return passkeyListSchema.parse(res.json()).passkeys;
  }

  function revoke(session: string, ref: string, payload?: object) {
    return send(server, session, 'DELETE', `/api/passkeys/${ref}`, payload ? { payload } : {});
  }

  it('needs a signed-in person and a request from the panel', async () => {
    const signedOut = await server.app.inject({ method: 'GET', url: '/api/passkeys' });
    expect(signedOut.statusCode).toBe(401);
    const crossSite = await server.app.inject({
      method: 'POST',
      url: '/api/step-up/options',
      cookies: { [SESSION_COOKIE]: holder },
      headers: { origin: EVIL_ORIGIN, 'sec-fetch-site': 'cross-site' },
      payload: { purpose: 'passkey_add' },
    });
    expect(crossSite.statusCode).toBe(403);
    expect(errorCode(crossSite)).toBe('cross_site_request');
  });

  it('registers the first passkey only within 10 minutes of a Google sign-in', async () => {
    const stale = await sessionStartedMinutesAgo(ids.newcomer, 11);
    expect(await list(stale)).toEqual([]);
    const refused = await send(server, stale, 'POST', '/api/passkeys/registration/options', {
      payload: { name: 'Telefon' },
    });
    expect(refused.statusCode).toBe(403);
    expect(errorCode(refused)).toBe('passkey_not_allowed');

    const fresh = await sessionOf(server, accounts.newcomer);
    const { challengeId, options } = await registrationOptions(server, fresh, 'Telefon');
    const [person] = await adminQuery<{ handle: Buffer }>(
      'select webauthn_handle as handle from office.users where id = $1',
      [ids.newcomer],
    );
    expect(person?.handle).toHaveLength(16);
    expect(options).toMatchObject({
      rp: { id: RP_ID, name: 'Agent Office' },
      // A random handle and the person's name; never the address.
      user: {
        id: person?.handle.toString('base64url'),
        name: 'Yeni Çalışan',
        displayName: 'Yeni Çalışan',
      },
      timeout: 300_000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: [],
    });
    expect(options.pubKeyCredParams.map((param) => param.alg)).toEqual([-8, -7, -257]);
    // 16 random bytes followed by the hash of what the registration is for.
    expect(Buffer.from(options.challenge, 'base64url')).toHaveLength(48);

    const res = await send(server, fresh, 'POST', '/api/passkeys/registration', {
      payload: { challengeId, name: 'Telefon', response: newcomerKey.create(options) },
    });
    expect(res.statusCode).toBe(201);
    const passkey = passkeySchema.parse(res.json());
    expect(passkey).toMatchObject({
      name: 'Telefon',
      deviceType: 'multiDevice',
      backedUp: true,
      lastUsedAt: null,
    });
    expect(await list(fresh)).toEqual([passkey]);
    expect(
      await adminQuery('select id, counter, transports from office.passkeys where ref = $1', [
        passkey.id,
      ]),
    ).toEqual([{ id: newcomerKey.newest, counter: '0', transports: ['internal', 'hybrid'] }]);
    expect(await challengeState(challengeId)).toEqual({ failed_attempts: 0, consumed: true });

    // A further passkey needs a re-verification with this one, even in a fresh session.
    const further = await send(server, fresh, 'POST', '/api/passkeys/registration/options', {
      payload: { name: 'Bilgisayar' },
    });
    expect(further.statusCode).toBe(403);
    expect(errorCode(further)).toBe('step_up_required');
  });

  it('adds a further passkey only with a passkey re-verification, which is used once', async () => {
    first = await addPasskey(server, holder, holderKey, 'Dizüstü bilgisayar');
    firstCredential = holderKey.newest;

    const stepUp = await signStepUp(server, holder, holderKey, { purpose: 'passkey_add' });
    const { challengeId, options } = await registrationOptions(server, holder, 'Telefon', stepUp);
    expect(options).toMatchObject({
      excludeCredentials: [
        { id: firstCredential, type: 'public-key', transports: ['internal', 'hybrid'] },
      ],
    });
    expect(await challengeState(stepUp.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: true,
    });

    // Replayed, the re-verification is refused: its challenge is used up.
    const replay = await send(server, holder, 'POST', '/api/passkeys/registration/options', {
      payload: { name: 'Telefon', stepUp },
    });
    expect(replay.statusCode).toBe(403);
    expect(errorCode(replay)).toBe('step_up_failed');

    // A registration for another origin, another RP ID, without user verification or for another
    // name than the options were made for counts a failed attempt.
    const spoiled: { spoil: Spoil; name?: string }[] = [
      { spoil: { origin: EVIL_ORIGIN } },
      { spoil: { rpId: 'evil.example.test' } },
      { spoil: { userVerified: false } },
      { spoil: {}, name: 'Başka ad' },
    ];
    for (const [index, { spoil, name }] of spoiled.entries()) {
      const res = await send(server, holder, 'POST', '/api/passkeys/registration', {
        payload: {
          challengeId,
          name: name ?? 'Telefon',
          response: holderKey.create(options, spoil),
        },
      });
      expect(res.statusCode, JSON.stringify(spoil)).toBe(403);
      expect(errorCode(res)).toBe('passkey_registration_failed');
      expect(await challengeState(challengeId)).toEqual({
        failed_attempts: index + 1,
        consumed: false,
      });
    }

    const res = await send(server, holder, 'POST', '/api/passkeys/registration', {
      payload: { challengeId, name: 'Telefon', response: holderKey.create(options) },
    });
    expect(res.statusCode).toBe(201);
    second = passkeySchema.parse(res.json());
    secondCredential = holderKey.newest;
    expect((await list(holder)).map((passkey) => passkey.id)).toEqual([first.id, second.id]);
    expect(await challengeState(challengeId)).toEqual({ failed_attempts: 4, consumed: true });

    // The registration challenge is used once.
    const again = await send(server, holder, 'POST', '/api/passkeys/registration', {
      payload: { challengeId, name: 'Telefon', response: holderKey.create(options) },
    });
    expect(again.statusCode).toBe(403);
    expect(errorCode(again)).toBe('passkey_registration_failed');
  });

  it('opens a re-verification only for a person with a passkey and a well-formed purpose', async () => {
    const traveller = await sessionOf(server, accounts.traveller);
    const none = await send(server, traveller, 'POST', '/api/step-up/options', {
      payload: { purpose: 'passkey_add' },
    });
    expect(none.statusCode).toBe(409);
    expect(errorCode(none)).toBe('no_passkey');
    // The message names the panel page where a passkey is added.
    expect(apiErrorSchema.parse(none.json()).error.message).toMatch(/Güvenlik sayfasından/);

    for (const payload of [
      { purpose: 'membership_change', subjectId: ids.changer, details: { action: 'remove' } },
      {
        purpose: 'membership_change',
        companyId: ids.arma,
        subjectId: ids.changer,
        details: { action: 'rename' },
      },
      { purpose: 'membership_change', companyId: ids.arma, subjectId: ids.changer },
      { purpose: 'passkey_add', subjectId: first.id },
      { purpose: 'passkey_add', companyId: ids.arma },
      { purpose: 'passkey_revoke' },
      { purpose: 'passkey_revoke', subjectId: first.id, details: { reason: 'lost' } },
      { purpose: 'approve', subjectId: randomUUID() },
      { purpose: 'unknown' },
    ]) {
      const res = await send(server, holder, 'POST', '/api/step-up/options', { payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }

    const { options } = await stepUpOptions(server, holder, { purpose: 'passkey_add' });
    expect(options).toMatchObject({ rpId: RP_ID, userVerification: 'required', timeout: 300_000 });
    expect(options.allowCredentials?.map((credential) => credential.id)).toEqual([
      firstCredential,
      secondCredential,
    ]);
    expect(Buffer.from(options.challenge, 'base64url')).toHaveLength(48);
  });

  it('counts every failed attempt and keeps the count; the fifth closes the challenge', async () => {
    const session = await sessionOf(server, accounts.holder);
    const { challengeId, options } = await stepUpOptions(server, session, {
      purpose: 'passkey_revoke',
      subjectId: second.id,
    });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await revoke(session, second.id, {
        stepUp: {
          challengeId,
          response: holderKey.get(options, firstCredential, { badSignature: true }),
        },
      });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
      expect(await challengeState(challengeId)).toEqual({
        failed_attempts: attempt,
        consumed: attempt === 5,
      });
    }
    // Closed: a valid signature is refused too.
    const valid = await revoke(session, second.id, {
      stepUp: { challengeId, response: holderKey.get(options, firstCredential) },
    });
    expect(valid.statusCode).toBe(403);
    expect(errorCode(valid)).toBe('step_up_failed');
    expect((await list(session)).map((passkey) => passkey.id)).toEqual([first.id, second.id]);
  });

  it('refuses another origin or RP ID, a missing user verification and another user handle', async () => {
    const session = await sessionOf(server, accounts.holder);
    const spoils: Spoil[] = [
      { origin: EVIL_ORIGIN },
      { origin: `http://${RP_ID}` },
      { rpId: 'evil.example.test' },
      { rpId: 'example.test' },
      { userVerified: false },
      { userHandle: randomBytes(16).toString('base64url') },
      { userHandle: null },
      { challenge: randomBytes(48).toString('base64url') },
    ];
    for (const spoil of spoils) {
      const { challengeId, options } = await stepUpOptions(server, session, {
        purpose: 'passkey_revoke',
        subjectId: second.id,
      });
      const res = await revoke(session, second.id, {
        stepUp: { challengeId, response: holderKey.get(options, firstCredential, spoil) },
      });
      expect(res.statusCode, JSON.stringify(spoil)).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
      expect(await challengeState(challengeId)).toEqual({ failed_attempts: 1, consumed: false });
    }
    expect(await list(session)).toHaveLength(2);
  });

  it('refuses a ceremony that ran in a frame of another page, counted as a failed attempt', async () => {
    const session = await sessionOf(server, accounts.holder);
    // A page on a sibling subdomain frames the panel: the browser reports crossOrigin, and Safari
    // no topOrigin (the library refuses it only with topOrigin).
    const framed: Spoil[] = [
      { crossOrigin: true },
      { crossOrigin: true, topOrigin: 'https://office-test.example.test' },
      { topOrigin: PANEL_ORIGIN },
    ];
    for (const spoil of framed) {
      const { challengeId, options } = await stepUpOptions(server, session, {
        purpose: 'passkey_revoke',
        subjectId: second.id,
      });
      const res = await revoke(session, second.id, {
        stepUp: { challengeId, response: holderKey.get(options, firstCredential, spoil) },
      });
      expect(res.statusCode, JSON.stringify(spoil)).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
      expect(await challengeState(challengeId)).toEqual({ failed_attempts: 1, consumed: false });
    }
    expect(await list(session)).toHaveLength(2);

    // A registration too.
    const stepUp = await signStepUp(
      server,
      session,
      holderKey,
      { purpose: 'passkey_add' },
      {
        credentialId: firstCredential,
      },
    );
    const { challengeId, options } = await registrationOptions(server, session, 'Çerçeve', stepUp);
    const res = await send(server, session, 'POST', '/api/passkeys/registration', {
      payload: {
        challengeId,
        name: 'Çerçeve',
        // Another authenticator, so that the holder's newest credential stays a registered one.
        response: new SoftwareAuthenticator(PANEL_ORIGIN).create(options, { crossOrigin: true }),
      },
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('passkey_registration_failed');
    expect(await challengeState(challengeId)).toEqual({ failed_attempts: 1, consumed: false });
    expect(await list(session)).toHaveLength(2);
  });

  it('replaces the open challenge of a dialog that is opened again', async () => {
    const session = await sessionOf(server, accounts.holder);
    const request = { purpose: 'passkey_revoke', subjectId: second.id } as const;
    const older = await stepUpOptions(server, session, request);
    const other = await stepUpOptions(server, session, {
      purpose: 'passkey_revoke',
      subjectId: first.id,
    });
    const newer = await stepUpOptions(server, session, request);
    expect(await challengeState(older.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: true,
    });
    expect(await challengeState(other.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(await challengeState(newer.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    const stale = await revoke(session, second.id, {
      stepUp: {
        challengeId: older.challengeId,
        response: holderKey.get(older.options, firstCredential),
      },
    });
    expect(stale.statusCode).toBe(403);
    expect(errorCode(stale)).toBe('step_up_failed');
    // Opening the same dialog again and again never reaches the limit of open challenges.
    for (let n = 0; n < 12; n += 1) {
      await stepUpOptions(server, session, request);
    }
    expect(await list(session)).toHaveLength(2);
  });

  it("refuses another person's passkey and a challenge of another session", async () => {
    const session = await sessionOf(server, accounts.holder);
    const request = { purpose: 'passkey_revoke', subjectId: second.id } as const;

    // The newcomer's passkey signs the holder's challenge.
    const foreign = await stepUpOptions(server, session, request);
    const byNewcomer = await revoke(session, second.id, {
      stepUp: { challengeId: foreign.challengeId, response: newcomerKey.get(foreign.options) },
    });
    expect(byNewcomer.statusCode).toBe(403);
    expect(errorCode(byNewcomer)).toBe('step_up_failed');
    expect(await challengeState(foreign.challengeId)).toEqual({
      failed_attempts: 1,
      consumed: false,
    });

    // A challenge opened in another session of the same person: refused, and that session's
    // challenge is neither counted nor used up.
    const elsewhere = await stepUpOptions(server, holder, request);
    const fromOtherSession = await revoke(session, second.id, {
      stepUp: {
        challengeId: elsewhere.challengeId,
        response: holderKey.get(elsewhere.options, firstCredential),
      },
    });
    expect(fromOtherSession.statusCode).toBe(403);
    expect(errorCode(fromOtherSession)).toBe('step_up_failed');
    expect(await challengeState(elsewhere.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(await list(session)).toHaveLength(2);
  });

  it('accepts a re-verification only for what it was signed for', async () => {
    const session = await sessionOf(server, accounts.holder);
    // Signed to remove the first passkey, sent to remove the second.
    const forFirst = await signStepUp(
      server,
      session,
      holderKey,
      { purpose: 'passkey_revoke', subjectId: first.id },
      { credentialId: firstCredential },
    );
    const otherSubject = await revoke(session, second.id, { stepUp: forFirst });
    expect(otherSubject.statusCode).toBe(403);
    expect(errorCode(otherSubject)).toBe('step_up_failed');

    // Signed to add a passkey, sent to remove one.
    const forAdding = await signStepUp(
      server,
      session,
      holderKey,
      { purpose: 'passkey_add' },
      { credentialId: firstCredential },
    );
    const otherPurpose = await revoke(session, second.id, { stepUp: forAdding });
    expect(otherPurpose.statusCode).toBe(403);
    expect(errorCode(otherPurpose)).toBe('step_up_failed');

    for (const challengeId of [forFirst.challengeId, forAdding.challengeId]) {
      expect(await challengeState(challengeId)).toEqual({ failed_attempts: 1, consumed: false });
    }
    expect(await list(session)).toHaveLength(2);
  });

  it('refuses a signature counter that did not increase (a cloned authenticator)', async () => {
    const counting = new SoftwareAuthenticator(PANEL_ORIGIN, { counting: true });
    const session = await sessionOf(server, accounts.employee);
    const passkey = await addPasskey(server, session, counting, 'Güvenlik anahtarı');

    // Counter 1: accepted and stored.
    const firstUse = await signStepUp(server, session, counting, { purpose: 'passkey_add' });
    await registrationOptions(server, session, 'Yedek anahtar', firstUse);
    expect(
      await adminQuery('select counter from office.passkeys where ref = $1', [passkey.id]),
    ).toEqual([{ counter: '1' }]);
    const used = (await list(session)).find((item) => item.id === passkey.id);
    expect(used?.lastUsedAt).not.toBeNull();

    // Counter 1 again: refused.
    const cloned = await signStepUp(
      server,
      session,
      counting,
      { purpose: 'passkey_add' },
      { spoil: { counter: 1 } },
    );
    const res = await send(server, session, 'POST', '/api/passkeys/registration/options', {
      payload: { name: 'Yedek anahtar', stepUp: cloned },
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('step_up_failed');
  });

  it('removes a passkey with a re-verification naming it; a removed one no longer verifies', async () => {
    const session = await sessionOf(server, accounts.holder);
    const missing = await revoke(session, second.id);
    expect(missing.statusCode).toBe(403);
    expect(errorCode(missing)).toBe('step_up_required');

    // The first passkey confirms removing the second.
    const stepUp = await signStepUp(
      server,
      session,
      holderKey,
      { purpose: 'passkey_revoke', subjectId: second.id },
      { credentialId: firstCredential },
    );
    const res = await revoke(session, second.id, { stepUp });
    expect(res.statusCode).toBe(204);
    expect((await list(session)).map((passkey) => passkey.id)).toEqual([first.id]);
    expect(
      await adminQuery<{ revoked: boolean }>(
        'select revoked_at is not null as revoked from office.passkeys where ref = $1',
        [second.id],
      ),
    ).toEqual([{ revoked: true }]);
    expect((await revoke(session, second.id, { stepUp })).statusCode).toBe(404);
    expect((await revoke(session, randomUUID(), { stepUp })).statusCode).toBe(404);
    expect((await revoke(session, 'not-a-uuid', { stepUp })).statusCode).toBe(404);

    // The removed passkey is no longer offered and its signature no longer counts.
    const { challengeId, options } = await stepUpOptions(server, session, {
      purpose: 'passkey_add',
    });
    expect(options.allowCredentials?.map((credential) => credential.id)).toEqual([firstCredential]);
    const withRemoved = await send(server, session, 'POST', '/api/passkeys/registration/options', {
      payload: {
        name: 'Tablet',
        stepUp: { challengeId, response: holderKey.get(options, secondCredential) },
      },
    });
    expect(withRemoved.statusCode).toBe(403);
    expect(errorCode(withRemoved)).toBe('step_up_failed');

    // The last passkey can be removed too, with itself; the person then has none.
    const last = await signStepUp(
      server,
      session,
      holderKey,
      { purpose: 'passkey_revoke', subjectId: first.id },
      { credentialId: firstCredential },
    );
    expect((await revoke(session, first.id, { stepUp: last })).statusCode).toBe(204);
    expect(await list(session)).toEqual([]);
    const none = await send(server, session, 'POST', '/api/step-up/options', {
      payload: { purpose: 'passkey_add' },
    });
    expect(none.statusCode).toBe(409);
    expect(errorCode(none)).toBe('no_passkey');

    // Recovery: within 10 minutes of a Google sign-in a new first passkey can be added.
    const replacement = await addPasskey(server, session, holderKey, 'Yeni telefon');
    expect(await list(session)).toEqual([replacement]);
  });
});
