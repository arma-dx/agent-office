import {
  createInvitationRequestSchema,
  invitationChangeDetails,
  invitationListSchema,
  invitationSchema,
  renewInvitationRequestSchema,
  type Invitation,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { ApiError, databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import { stepUpRequired, verifyStepUp } from '../passkeys.ts';
import type { RouteDeps } from '../services.ts';

/**
 * Invitations of the selected company; founder only (3 October decision 9). An invitation is valid
 * for 7 days and can be renewed, never beyond 30 days after it was created. Creating one sends no
 * email; the founder shares the panel address. The address never appears in a log line.
 *
 * An invitation becomes a membership, with its role and approval right, at the first sign-in of
 * the address. So creating one and renewing one need a passkey re-verification for exactly that
 * invitation (3 October decision 7), recorded in the same transaction; the database refuses either
 * without it. The panel chooses a new invitation's id, so the re-verification can name it.
 * Cancelling takes access away and needs none.
 */

const FOUNDER = { founderOnly: true } as const;
const LIST_LIMIT = 500;

const COLUMNS = `id, email, role, can_approve, created_at, expires_at,
  case
    when accepted_at is not null then 'accepted'
    when cancelled_at is not null then 'cancelled'
    when expires_at <= now() then 'expired'
    else 'pending'
  end as status`;

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  can_approve: boolean;
  created_at: Date;
  expires_at: Date;
  status: string;
}

interface InvitationState {
  accepted: boolean;
  cancelled: boolean;
  renewable: boolean;
}

const paramsSchema = z.object({ id: z.uuid() });

const approvalOnlyEmployee = (): ApiError =>
  new ApiError(400, 'approval_only_employee', 'Onay yetkisi yalnızca çalışana verilebilir.');

const invitationExists = (): ApiError =>
  new ApiError(
    409,
    'invitation_exists',
    'Bu adrese kabul edilmemiş bir davet zaten var; süresi dolmuş olabilir. Davetler listesinden süresini uzatın ya da daveti iptal edip yeniden oluşturun.',
  );

/** The answer to an invitation change the database refused for a missing re-verification. */
function invitationError(error: unknown): unknown {
  // invalid_authorization_specification: no re-verification for this invitation in the transaction.
  return databaseErrorCode(error) === '28000' ? stepUpRequired() : error;
}

function toInvitation(row: InvitationRow | undefined): Invitation {
  if (!row) {
    throw new Error('The invitation row is missing');
  }
  return invitationSchema.parse({
    id: row.id,
    email: row.email,
    role: row.role,
    canApprove: row.can_approve,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
  });
}

function invitationId(request: FastifyRequest): string {
  const params = paramsSchema.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data.id;
}

/** Locks the invitation of the context company; 404 when the founder cannot see it. */
async function lockInvitation(client: DbClient, id: string): Promise<InvitationState> {
  const { rows } = await client.query<InvitationState>(
    `select accepted_at is not null as accepted,
            cancelled_at is not null as cancelled,
            created_at + interval '30 days' > now() as renewable
     from office.invitations
     where id = $1 and company_id = office.ctx_company_id()
     for update`,
    [id],
  );
  const state = rows[0];
  if (!state) {
    throw notFound();
  }
  return state;
}

export function registerInvitationRoutes(
  app: FastifyInstance,
  { runner, config }: RouteDeps,
): void {
  app.get('/api/invitations', async (request, reply) =>
    runner.withCompany(request, reply, FOUNDER, async ({ client, companyId }) => {
      const { rows } = await client.query<InvitationRow>(
        `select ${COLUMNS} from office.invitations
         where company_id = $1
         order by created_at desc, id
         limit ${String(LIST_LIMIT)}`,
        [companyId],
      );
      return invitationListSchema.parse({ invitations: rows.map(toInvitation) });
    }),
  );

  app.post('/api/invitations', async (request, reply) => {
    const invitation = await runner.withCompany(
      request,
      reply,
      FOUNDER,
      async ({ client, session, companyId }) => {
        const body = createInvitationRequestSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        const { id, email, role, canApprove, stepUp } = body.data;
        if (canApprove && role !== 'employee') {
          throw approvalOnlyEmployee();
        }
        const company = await client.query<{ kind: string }>(
          'select kind from office.companies where id = $1',
          [companyId],
        );
        if (company.rows[0]?.kind !== 'company') {
          throw new ApiError(
            400,
            'private_space',
            'Kurucu alanına davet oluşturulamaz. Bir şirket seçin.',
          );
        }
        // One open invitation per address and company, told before the passkey is asked for. An
        // expired invitation stays open until it is renewed or cancelled, so the message covers it.
        const open = await client.query(
          `select 1 from office.invitations
           where company_id = $1 and email = $2 and accepted_at is null and cancelled_at is null`,
          [companyId, email],
        );
        if (open.rowCount !== 0) {
          throw invitationExists();
        }
        await verifyStepUp({ client, session }, config.relyingParty, stepUp, {
          purpose: 'invitation',
          companyId,
          subjectId: id,
          details: invitationChangeDetails({ email, role, canApprove }),
        });
        try {
          const { rows } = await client.query<InvitationRow>(
            `insert into office.invitations (id, company_id, email, role, can_approve)
             values ($1, $2, $3, $4, $5)
             returning ${COLUMNS}`,
            [id, companyId, email, role, canApprove],
          );
          return toInvitation(rows[0]);
        } catch (error) {
          if (databaseErrorCode(error) === '23505') {
            // The id is taken (a request sent twice); otherwise an invitation opened meanwhile.
            const { constraint } = error as { constraint?: unknown };
            throw constraint === 'invitations_pkey' ? invalidRequest() : invitationExists();
          }
          throw invitationError(error);
        }
      },
    );
    return reply.code(201).send(invitation);
  });

  // Seven more days from now, but never beyond 30 days after the invitation was created.
  app.post('/api/invitations/:id/renew', async (request, reply) =>
    runner.withCompany(request, reply, FOUNDER, async ({ client, session, companyId }) => {
      const id = invitationId(request);
      const body = renewInvitationRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw invalidRequest();
      }
      const state = await lockInvitation(client, id);
      if (state.accepted || state.cancelled) {
        throw new ApiError(
          409,
          'invitation_closed',
          'Bu davet kabul edilmiş ya da iptal edilmiş; süresi uzatılamaz.',
        );
      }
      if (!state.renewable) {
        throw new ApiError(
          409,
          'invitation_limit',
          'Davetin süresi 30 günden fazla uzatılamaz. Daveti iptal edip yeniden oluşturun.',
        );
      }
      await verifyStepUp({ client, session }, config.relyingParty, body.data.stepUp, {
        purpose: 'invitation',
        companyId,
        subjectId: id,
        details: invitationChangeDetails('renew'),
      });
      try {
        const { rows } = await client.query<InvitationRow>(
          `update office.invitations
           set expires_at = least(now() + interval '7 days', created_at + interval '30 days')
           where id = $1
           returning ${COLUMNS}`,
          [id],
        );
        return toInvitation(rows[0]);
      } catch (error) {
        throw invitationError(error);
      }
    }),
  );

  // Cancelling twice is not an error; an accepted invitation cannot be cancelled.
  app.post('/api/invitations/:id/cancel', async (request, reply) => {
    await runner.withCompany(request, reply, FOUNDER, async ({ client }) => {
      const id = invitationId(request);
      const state = await lockInvitation(client, id);
      if (state.accepted) {
        throw new ApiError(
          409,
          'invitation_closed',
          'Bu davet kabul edilmiş; iptal edilemez. Kişinin üyeliğini Üyeler listesinden kaldırabilirsiniz.',
        );
      }
      if (!state.cancelled) {
        await client.query('update office.invitations set cancelled_at = now() where id = $1', [
          id,
        ]);
      }
    });
    return reply.code(204).send();
  });
}
