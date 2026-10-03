import {
  sessionResponseSchema,
  setCompanyRequestSchema,
  type SessionResponse,
} from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import { noCompanyAccess } from '../db.ts';
import { databaseErrorCode, invalidRequest, unauthenticated } from '../errors.ts';
import { setCompanyCookie } from '../session.ts';
import type { RouteDeps } from '../services.ts';

interface MembershipRow {
  company_id: string;
  code: string;
  name: string;
  kind: string;
  role: string;
  can_approve: boolean;
}

export function registerSessionRoutes(app: FastifyInstance, { runner, config }: RouteDeps): void {
  // The signed-in person and the companies they can open; the row policies show only their own
  // record and memberships.
  app.get('/api/session', async (request, reply): Promise<SessionResponse> => {
    return runner.withSession(request, reply, async ({ client, session }) => {
      const user = await client.query<{ id: string; name: string }>(
        'select id, name from office.users where id = $1',
        [session.userId],
      );
      const person = user.rows[0];
      if (!person) {
        throw unauthenticated();
      }
      const memberships = await client.query<MembershipRow>(
        `select c.id as company_id, c.code, c.name, c.kind, m.role, m.can_approve
         from office.memberships m
         join office.companies c on c.id = m.company_id
         where m.user_id = $1
         order by c.kind = 'private_space', c.name, c.id`,
        [session.userId],
      );
      const companies = memberships.rows.map((row) => ({
        companyId: row.company_id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        role: row.role,
        canApprove: row.can_approve,
      }));
      const lastCompanyId = companies.some((m) => m.companyId === session.lastCompanyId)
        ? session.lastCompanyId
        : null;
      return sessionResponseSchema.parse({
        user: { id: person.id, name: person.name },
        memberships: companies,
        lastCompanyId,
      });
    });
  });

  // Remembers the company picked in the panel as the default: for this session in the database,
  // and in this browser's company cookie for the next sign-in.
  app.put('/api/session/company', async (request, reply) => {
    const companyId = await runner.withSession(request, reply, async ({ client, session }) => {
      const body = setCompanyRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      try {
        await client.query('select office.set_last_company($1, $2)', [
          session.keyHash,
          body.data.companyId,
        ]);
      } catch (error) {
        // insufficient_privilege: not a member of that company.
        if (databaseErrorCode(error) === '42501') {
          throw noCompanyAccess();
        }
        throw error;
      }
      return body.data.companyId;
    });
    setCompanyCookie(reply, config, companyId);
    return reply.code(204).send();
  });
}
