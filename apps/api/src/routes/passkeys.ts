import {
  passkeyListSchema,
  passkeySchema,
  registrationOptionsRequestSchema,
  registrationOptionsResponseSchema,
  registrationRequestSchema,
  revokePasskeyRequestSchema,
  stepUpOptionsRequestSchema,
  stepUpOptionsResponseSchema,
  type Passkey,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import {
  MAX_PASSKEYS,
  activeCredentials,
  passkeyLimit,
  registerPasskey,
  registrationOptions,
  stepUpOptions,
  stepUpRequired,
  verifyStepUp,
} from '../passkeys.ts';
import type { RouteDeps } from '../services.ts';

/**
 * The signed-in person's passkeys and the re-verification challenges (3 October decision 7). A
 * passkey belongs to the person, not to a company, so these routes need no company.
 *
 * Only a person without an active passkey can add a first passkey (within 10 minutes of a Google
 * sign-in). A lost passkey stays active, and its owner revokes it with another passkey. A person
 * who lost every passkey cannot recover here: a founder of their company resets their passkeys
 * (POST /api/members/:userId/passkeys/reset; 5 October decision 3), and they add a first passkey
 * after a new Google sign-in. A founder's own passkeys are reset by the database administrator.
 */

interface PasskeyRow {
  ref: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
  device_type: string;
  backed_up: boolean;
}

const PASSKEY_COLUMNS = 'ref, name, created_at, last_used_at, device_type, backed_up';

const paramsSchema = z.object({ id: z.uuid() });

function toPasskey(row: PasskeyRow | undefined): Passkey {
  if (!row) {
    throw new Error('The passkey row is missing');
  }
  return passkeySchema.parse({
    id: row.ref,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    deviceType: row.device_type,
    backedUp: row.backed_up,
  });
}

async function readPasskey(client: DbClient, ref: string): Promise<Passkey> {
  const { rows } = await client.query<PasskeyRow>(
    `select ${PASSKEY_COLUMNS} from office.passkeys where ref = $1 and revoked_at is null`,
    [ref],
  );
  return toPasskey(rows[0]);
}

function passkeyRef(request: FastifyRequest): string {
  const params = paramsSchema.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data.id;
}

export function registerPasskeyRoutes(app: FastifyInstance, { runner, config }: RouteDeps): void {
  const relyingParty = config.relyingParty;

  app.get('/api/passkeys', async (request, reply) =>
    runner.withSession(request, reply, async ({ client, session }) => {
      const { rows } = await client.query<PasskeyRow>(
        `select ${PASSKEY_COLUMNS} from office.passkeys
         where user_id = $1 and revoked_at is null
         order by created_at, ref`,
        [session.userId],
      );
      return passkeyListSchema.parse({ passkeys: rows.map(toPasskey) });
    }),
  );

  /**
   * The first passkey needs no re-verification (a stepUp sent with it is not used); every further
   * one confirms a passkey_add re-verification here, which the registration challenge uses up.
   */
  app.post('/api/passkeys/registration/options', async (request, reply) =>
    runner.withSession(request, reply, async (scope) => {
      const body = registrationOptionsRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const existing = await activeCredentials(scope);
      if (existing.length >= MAX_PASSKEYS) {
        throw passkeyLimit();
      }
      if (existing.length > 0) {
        await verifyStepUp(scope, relyingParty, body.data.stepUp, {
          purpose: 'passkey_add',
          companyId: null,
          subjectId: null,
          details: null,
        });
      }
      const result = await registrationOptions(scope, relyingParty, body.data.name, existing);
      return registrationOptionsResponseSchema.parse(result);
    }),
  );

  app.post('/api/passkeys/registration', async (request, reply) => {
    const passkey = await runner.withSession(request, reply, async (scope) => {
      const body = registrationRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const ref = await registerPasskey(scope, relyingParty, body.data);
      return readPasskey(scope.client, ref);
    });
    return reply.code(201).send(passkey);
  });

  // The last passkey can be removed too; a new first passkey then needs a fresh Google sign-in.
  app.delete('/api/passkeys/:id', async (request, reply) => {
    await runner.withSession(request, reply, async (scope) => {
      const ref = passkeyRef(request);
      const body = revokePasskeyRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw invalidRequest();
      }
      const { rows } = await scope.client.query<{ id: string }>(
        `select id from office.passkeys
         where ref = $1 and user_id = $2 and revoked_at is null`,
        [ref, scope.session.userId],
      );
      const credentialId = rows[0]?.id;
      if (credentialId === undefined) {
        throw notFound();
      }
      await verifyStepUp(scope, relyingParty, body.data.stepUp, {
        purpose: 'passkey_revoke',
        companyId: null,
        subjectId: ref,
        details: null,
      });
      try {
        await scope.client.query('select office.revoke_passkey($1, $2)', [
          scope.session.keyHash,
          credentialId,
        ]);
      } catch (error) {
        const code = databaseErrorCode(error);
        // no_data_found: revoked meanwhile.
        if (code === 'P0002') {
          throw notFound();
        }
        if (code === '28000') {
          throw stepUpRequired();
        }
        throw error;
      }
    });
    return reply.code(204).send();
  });

  /**
   * A challenge for one re-verification, bound to what it confirms (the shared schema says what
   * each purpose names: a company, a subject, details). The company and the subject are checked
   * when the action runs, where the database records the re-verification only in that company's
   * context.
   */
  app.post('/api/step-up/options', async (request, reply) =>
    runner.withSession(request, reply, async (scope) => {
      const body = stepUpOptionsRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { purpose, companyId, subjectId, details } = body.data;
      const result = await stepUpOptions(scope, relyingParty, {
        purpose,
        companyId: companyId ?? null,
        subjectId: subjectId ?? null,
        details: details ?? null,
      });
      return stepUpOptionsResponseSchema.parse(result);
    }),
  );
}
