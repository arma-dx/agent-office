import {
  memberChangeDetails,
  memberListSchema,
  memberSchema,
  removeMemberRequestSchema,
  resetPasskeysRequestSchema,
  updateMemberRequestSchema,
  type Member,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { ApiError, databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import { stepUpRequired, verifyStepUp } from '../passkeys.ts';
import type { RouteDeps } from '../services.ts';

/**
 * Memberships of the selected company; founder only. The founder role is neither granted nor taken
 * here: a founder's membership (another founder's too) cannot be changed or removed through the
 * API, so a stolen founder session cannot lock the other founders out. The database also keeps at
 * least one active founder per company and the founder space's founder.
 *
 * Changing a role or the approval right and removing a membership need a passkey re-verification
 * for exactly that change (3 October decision 7), recorded in the same transaction; the database
 * refuses the change without it.
 *
 * A founder also resets every passkey of a member who lost theirs (5 October decision 3), with a
 * passkey re-verification naming that person. The database decides who may be reset
 * (can_reset_passkeys), revokes the passkeys, closes the person's sessions and writes the audit
 * row and the person's notification (reset_passkeys). A founder's passkeys (their own or another
 * founder's) are never reset here: the database administrator does that by hand
 * (office.admin_reset_passkeys).
 */

const FOUNDER = { founderOnly: true } as const;

interface MemberRow {
  user_id: string;
  name: string;
  role: string;
  can_approve: boolean;
  active: boolean;
}

const paramsSchema = z.object({ userId: z.uuid() });

const lastFounder = (): ApiError =>
  new ApiError(
    409,
    'last_founder',
    'Şirketin son kurucusu kaldırılamaz ya da rolü değiştirilemez.',
  );

const founderMembership = (): ApiError =>
  new ApiError(
    409,
    'founder_membership',
    'Kurucunun rolü, onay yetkisi ve üyeliği panelden değiştirilemez.',
  );

const passkeyResetSelf = (): ApiError =>
  new ApiError(
    409,
    'passkey_reset_self',
    "Kendi passkey'lerinizi buradan sıfırlayamazsınız. Passkey eklemek ya da kaldırmak için Güvenlik sayfasını kullanın.",
  );

// One answer for every person the founder may not reset, whatever the reason: the reason can be a
// membership in a company the founder does not run, which the founder must not learn (rule 9).
const passkeyResetNotAllowed = (): ApiError =>
  new ApiError(
    409,
    'passkey_reset_not_allowed',
    "Bu kişinin passkey'leri panelden sıfırlanamaz. Sıfırlama için veritabanı yöneticisine başvurun.",
  );

/** The role of the person's membership, locked for the change; 404 when there is none. */
async function lockMembership(
  client: DbClient,
  companyId: string,
  userId: string,
): Promise<{ role: string; can_approve: boolean }> {
  const { rows } = await client.query<{ role: string; can_approve: boolean }>(
    `select role, can_approve from office.memberships
     where company_id = $1 and user_id = $2
     for update`,
    [companyId, userId],
  );
  const member = rows[0];
  if (!member) {
    throw notFound();
  }
  if (member.role === 'founder') {
    throw founderMembership();
  }
  return member;
}

function toMember(row: MemberRow): Member {
  return memberSchema.parse({
    userId: row.user_id,
    name: row.name,
    role: row.role,
    canApprove: row.can_approve,
    active: row.active,
  });
}

function memberId(request: FastifyRequest): string {
  const params = paramsSchema.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data.userId;
}

async function readMember(client: DbClient, companyId: string, userId: string): Promise<Member> {
  const { rows } = await client.query<MemberRow>(
    `select m.user_id, u.name, m.role, m.can_approve, u.active
     from office.memberships m
     join office.users u on u.id = m.user_id
     where m.company_id = $1 and m.user_id = $2`,
    [companyId, userId],
  );
  const row = rows[0];
  if (!row) {
    throw notFound();
  }
  return toMember(row);
}

/** The answer to a membership change the database refused. */
function membershipError(error: unknown): unknown {
  const code = databaseErrorCode(error);
  // check_violation: the founder guard (last founder, founder space).
  if (code === '23514') {
    return lastFounder();
  }
  // invalid_authorization_specification: no re-verification for this change in the transaction.
  if (code === '28000') {
    return stepUpRequired();
  }
  return error;
}

export function registerMemberRoutes(app: FastifyInstance, { runner, config }: RouteDeps): void {
  app.get('/api/members', async (request, reply) =>
    runner.withCompany(request, reply, FOUNDER, async ({ client, companyId }) => {
      const { rows } = await client.query<MemberRow>(
        `select m.user_id, u.name, m.role, m.can_approve, u.active
         from office.memberships m
         join office.users u on u.id = m.user_id
         where m.company_id = $1
         order by u.name, m.user_id`,
        [companyId],
      );
      return memberListSchema.parse({ members: rows.map(toMember) });
    }),
  );

  /**
   * Role (employee or external) and the approval right. Only an employee has the approval right:
   * becoming external drops it, and a role change starts without it unless the request grants it.
   */
  app.patch('/api/members/:userId', async (request, reply) =>
    runner.withCompany(request, reply, FOUNDER, async ({ client, session, companyId }) => {
      const userId = memberId(request);
      const body = updateMemberRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const member = await lockMembership(client, companyId, userId);
      const role = body.data.role ?? member.role;
      if (role !== 'employee' && body.data.canApprove === true) {
        throw new ApiError(
          400,
          'approval_only_employee',
          'Onay yetkisi yalnızca çalışana verilebilir.',
        );
      }
      const keptRight = member.role === 'employee' && member.can_approve;
      const canApprove = role === 'employee' && (body.data.canApprove ?? keptRight);
      await verifyStepUp({ client, session }, config.relyingParty, body.data.stepUp, {
        purpose: 'membership_change',
        companyId,
        subjectId: userId,
        details: memberChangeDetails(body.data),
      });
      try {
        await client.query(
          `update office.memberships set role = $3, can_approve = $4
           where company_id = $1 and user_id = $2`,
          [companyId, userId, role, canApprove],
        );
      } catch (error) {
        throw membershipError(error);
      }
      return readMember(client, companyId, userId);
    }),
  );

  // Removing the last membership closes the person's sessions; the database does that.
  app.delete('/api/members/:userId', async (request, reply) => {
    await runner.withCompany(request, reply, FOUNDER, async ({ client, session, companyId }) => {
      const userId = memberId(request);
      const body = removeMemberRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw invalidRequest();
      }
      await lockMembership(client, companyId, userId);
      await verifyStepUp({ client, session }, config.relyingParty, body.data.stepUp, {
        purpose: 'membership_change',
        companyId,
        subjectId: userId,
        details: memberChangeDetails('remove'),
      });
      let removed: number;
      try {
        const result = await client.query(
          'delete from office.memberships where company_id = $1 and user_id = $2',
          [companyId, userId],
        );
        removed = result.rowCount ?? 0;
      } catch (error) {
        const code = databaseErrorCode(error);
        if (code === '23503') {
          throw new ApiError(
            409,
            'member_in_use',
            'Bu kişiye bağlı kayıtlar olduğu için üyelik kaldırılamadı. Kayıtları başka birine aktarıp yeniden deneyin.',
          );
        }
        throw membershipError(error);
      }
      if (removed === 0) {
        throw notFound();
      }
    });
    return reply.code(204).send();
  });

  /**
   * Resets every passkey of the member (5 October decision 3): one transaction records the
   * passkey_reset re-verification for this person and resets the passkeys, which closes the
   * person's sessions and writes the audit row and the person's notification.
   *
   * Before the passkey is asked for, the route refuses only what the founder's own member list
   * shows: their own passkeys, a person who is no member of the company, and a founder. Whether
   * the person may be reset at all (can_reset_passkeys: not when they are also a member of a
   * company this founder does not run) is asked after the founder's passkey checked out, so a
   * founder session without the passkey learns nothing about a member's other companies; the
   * refusal rolls the re-verification back, so it is not used up.
   */
  app.post('/api/members/:userId/passkeys/reset', async (request, reply) => {
    await runner.withCompany(request, reply, FOUNDER, async ({ client, session, companyId }) => {
      const userId = memberId(request).toLowerCase();
      const body = resetPasskeysRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw invalidRequest();
      }
      if (userId === session.userId.toLowerCase()) {
        throw passkeyResetSelf();
      }
      const membership = await client.query<{ role: string }>(
        'select role from office.memberships where company_id = $1 and user_id = $2',
        [companyId, userId],
      );
      const member = membership.rows[0];
      if (!member) {
        throw notFound();
      }
      // A founder's passkeys are reset by the database administrator, like their own.
      if (member.role === 'founder') {
        throw passkeyResetNotAllowed();
      }
      await verifyStepUp({ client, session }, config.relyingParty, body.data.stepUp, {
        purpose: 'passkey_reset',
        companyId,
        subjectId: userId,
        details: null,
      });
      const { rows } = await client.query<{ allowed: boolean }>(
        'select office.can_reset_passkeys($1) as allowed',
        [userId],
      );
      if (rows[0]?.allowed !== true) {
        throw passkeyResetNotAllowed();
      }
      try {
        await client.query('select office.reset_passkeys($1, $2)', [session.keyHash, userId]);
      } catch (error) {
        const code = databaseErrorCode(error);
        // invalid_authorization_specification: no re-verification for this person in the
        // transaction.
        if (code === '28000') {
          throw stepUpRequired();
        }
        // insufficient_privilege: the person's memberships changed meanwhile.
        if (code === '42501') {
          throw passkeyResetNotAllowed();
        }
        throw error;
      }
    });
    return reply.code(204).send();
  });
}
