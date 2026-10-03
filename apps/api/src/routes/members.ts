import {
  memberListSchema,
  memberSchema,
  updateMemberRequestSchema,
  type Member,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { ApiError, databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import type { RouteDeps } from '../services.ts';

/**
 * Memberships of the selected company; founder only. The founder role is neither granted nor taken
 * here: a founder's membership (another founder's too) cannot be changed or removed through the
 * API, so a stolen founder session cannot lock the other founders out. The database also keeps at
 * least one active founder per company and the founder space's founder.
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

export function registerMemberRoutes(app: FastifyInstance, { runner }: RouteDeps): void {
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
    runner.withCompany(request, reply, FOUNDER, async ({ client, companyId }) => {
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
      try {
        await client.query(
          `update office.memberships set role = $3, can_approve = $4
           where company_id = $1 and user_id = $2`,
          [companyId, userId, role, canApprove],
        );
      } catch (error) {
        // check_violation: the founder guard (last founder, founder space).
        if (databaseErrorCode(error) === '23514') {
          throw lastFounder();
        }
        throw error;
      }
      return readMember(client, companyId, userId);
    }),
  );

  // Removing the last membership closes the person's sessions; the database does that.
  app.delete('/api/members/:userId', async (request, reply) => {
    await runner.withCompany(request, reply, FOUNDER, async ({ client, companyId }) => {
      const userId = memberId(request);
      await lockMembership(client, companyId, userId);
      let removed: number;
      try {
        const result = await client.query(
          'delete from office.memberships where company_id = $1 and user_id = $2',
          [companyId, userId],
        );
        removed = result.rowCount ?? 0;
      } catch (error) {
        const code = databaseErrorCode(error);
        if (code === '23514') {
          throw lastFounder();
        }
        if (code === '23503') {
          throw new ApiError(
            409,
            'member_in_use',
            'Bu kişiye bağlı kayıtlar olduğu için üyelik kaldırılamadı. Kayıtları başka birine aktarıp yeniden deneyin.',
          );
        }
        throw error;
      }
      if (removed === 0) {
        throw notFound();
      }
    });
    return reply.code(204).send();
  });
}
