import { readAgentSwitch, setAgentSwitch, stopAgentIfOpen, writeAudit } from '@agent-office/db';
import {
  agentCodeSchema,
  agentStopIfOpenResponseSchema,
  agentSwitchRequestSchema,
  type OfficeAgent,
} from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import type { RouteDeps } from '../services.ts';

/**
 * The agent's switch for the selected company (CLAUDE.md: "Her ajanın her şirket için bir durdurma
 * düğmesi vardır; düğme company_agents satırındadır"). Only the founder: the row policy of
 * company_agents lets nobody else write, and the route says so first.
 *
 *   PUT /api/agents/:agentCode/switch  { status: 'enabled' }
 *                                      { status: 'stopped', onlyIfOpen?: boolean }
 *
 * A stopped agent takes no new work (the database refuses a new run and a routing to it), and the
 * runner ends its open run before the next step. An agent whose card has no version to run with
 * cannot be opened (409 agent_not_ready). The change is written to the audit log with the founder
 * as the actor.
 *
 * "Her yerde durdur" (8 October decision 9) is not a route: every request runs in one company
 * (rule 9), so the panel sends one stop per company, each with `onlyIfOpen`. Such a stop changes
 * only a switch that is open: a closed, stopped or never opened agent is answered as it is (200),
 * no row is made and nothing is written to the audit log. The answer carries `changed`: whether
 * this request is what stopped the agent, so the panel never reports an agent that was already
 * stopped as stopped by this act.
 */

const FOUNDER = { founderOnly: true } as const;
const params = z.object({ agentCode: agentCodeSchema });

const agentNotAvailable = (): ApiError =>
  new ApiError(409, 'agent_not_available', 'Bu ajan bu şirket için tanımlı değil.');

const agentNotReady = (): ApiError =>
  new ApiError(
    409,
    'agent_not_ready',
    'Bu ajan henüz açılamaz: kartının çalışacak sürümü yok. Kartın becerileri yazılıp tanımlar eşitlenince (pnpm db:sync-definitions) açılabilir.',
  );

export function registerAgentRoutes(app: FastifyInstance, { runner }: RouteDeps): void {
  app.put('/api/agents/:agentCode/switch', async (request, reply): Promise<OfficeAgent> =>
    runner.withCompany(request, reply, FOUNDER, async ({ client }) => {
      const parsed = params.safeParse(request.params);
      if (!parsed.success) {
        throw notFound();
      }
      const body = agentSwitchRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { agentCode } = parsed.data;
      if (body.data.status === 'stopped' && body.data.onlyIfOpen === true) {
        // "Her yerde durdur": the panel sends this once per company. An agent that is not open
        // here stays exactly as it is, and nothing is written about it.
        const stopped = await stopAgentIfOpen(client, agentCode);
        if (stopped !== null) {
          await writeAudit(client, 'agent_stopped', 'company_agent', stopped.id);
        }
        const now = await readAgentSwitch(client, agentCode);
        if (now === null) {
          throw notFound();
        }
        return agentStopIfOpenResponseSchema.parse({
          code: agentCode,
          name: now.name,
          status: now.status,
          ready: now.ready,
          changed: stopped !== null,
        });
      }
      let row: Awaited<ReturnType<typeof setAgentSwitch>>;
      await client.query('savepoint agent_switch');
      try {
        row = await setAgentSwitch(client, agentCode, body.data.status);
      } catch (error) {
        await client.query('rollback to savepoint agent_switch');
        // check_violation: the card does not name this company.
        if (databaseErrorCode(error) === '23514') {
          throw agentNotAvailable();
        }
        throw error;
      }
      if (row === 'unknown') {
        throw notFound();
      }
      // An agent without a card version could be given a request and would never start.
      if (row === 'not_ready') {
        throw agentNotReady();
      }
      await writeAudit(
        client,
        body.data.status === 'enabled' ? 'agent_enabled' : 'agent_stopped',
        'company_agent',
        row.id,
      );
      const { rows } = await client.query<{ name: string; ready: boolean }>(
        `select name, current_version_id is not null as ready
         from office.agent_definitions where code = $1`,
        [agentCode],
      );
      return {
        code: agentCode,
        name: rows[0]?.name ?? agentCode,
        status: body.data.status,
        ready: rows[0]?.ready === true,
      };
    }),
  );
}
