import {
  countWaitingWork,
  readAgentSwitch,
  setAgentSwitch,
  stopAgentIfOpen,
  writeAudit,
} from '@agent-office/db';
import {
  agentCodeSchema,
  agentOpenResponseSchema,
  agentStopIfOpenResponseSchema,
  agentSwitchRequestSchema,
  waitingWorkQuerySchema,
  waitingWorkResponseSchema,
  type AgentOpenResponse,
  type OfficeAgent,
  type WaitingWorkResponse,
} from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { founderOnly } from '../db.ts';
import { ApiError, databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import { startWaitingWork } from '../restart.ts';
import type { RouteDeps } from '../services.ts';

/**
 * The agent's switch for the selected company (CLAUDE.md: "Her ajanın her şirket için bir durdurma
 * düğmesi vardır; düğme company_agents satırındadır"). Only the founder: the row policy of
 * company_agents lets nobody else write, and the route says so first.
 *
 *   PUT /api/agents/:agentCode/switch  { status: 'enabled' }
 *                                      { status: 'stopped', onlyIfOpen?: boolean }
 *   GET /api/waiting-work              ?agent=<code> | ?project=<id> | ?customer=<id>
 *
 * A stopped agent takes no new work (the database refuses a new run and a routing to it), and the
 * runner ends its open run before the next step. Opening an agent starts the work that waited for
 * it again (8 October decision 49): the requests whose turn is this agent's and whose run the
 * switch stopped or whose start was missed; each is a new, paid run. The answer of an opening
 * says how many. An agent whose card has no version to run with cannot be opened (409
 * agent_not_ready). The change is written to the audit log with the founder as the actor.
 *
 * The count is read for the confirmation of an opening (of an agent here, of an AI permission in
 * routes/projects.ts); it promises nothing: the answer of the opening says what started.
 *
 * "Her yerde durdur" (8 October decision 9) is not a route: every request runs in one company
 * (rule 9), so the panel sends one stop per company, each with `onlyIfOpen`. Such a stop changes
 * only a switch that is open: a closed, stopped or never opened agent is answered as it is (200),
 * no row is made and nothing is written to the audit log. The answer carries `changed`: whether
 * this request is what stopped the agent, so the panel never reports an agent that was already
 * stopped as stopped by this act. Opening stays per company: each opening restarts the waiting
 * work of that company only.
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

export function registerAgentRoutes(app: FastifyInstance, { runner, jobs }: RouteDeps): void {
  app.put(
    '/api/agents/:agentCode/switch',
    async (request, reply): Promise<OfficeAgent | AgentOpenResponse> =>
      runner.withCompany(request, reply, FOUNDER, async ({ client, companyId }) => {
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
        // Decision 49: the work that waited for this agent starts again, in this transaction, when
        // this request is what opened it. An agent that was already open restarts nothing.
        let restarted = 0;
        if (body.data.status === 'enabled' && row.opened) {
          await client.query('savepoint restart_work');
          try {
            restarted = await startWaitingWork(client, jobs, companyId, { agentCode });
          } catch (error) {
            await client.query('rollback to savepoint restart_work');
            // insufficient_privilege: the person stopped being the founder inside this request.
            if (databaseErrorCode(error) === '42501') throw founderOnly();
            throw error;
          }
        }
        const { rows } = await client.query<{ name: string; ready: boolean }>(
          `select name, current_version_id is not null as ready
         from office.agent_definitions where code = $1`,
          [agentCode],
        );
        const agent = {
          code: agentCode,
          name: rows[0]?.name ?? agentCode,
          status: body.data.status,
          ready: rows[0]?.ready === true,
        };
        // Only an opening says how many requests it started; a stop answers as it always did.
        return body.data.status === 'enabled'
          ? agentOpenResponseSchema.parse({ ...agent, restarted })
          : agent;
      }),
  );

  /**
   * How many waiting requests an opening would start, for the confirmation the founder reads
   * before confirming (8 October decision 49). The database counts by the rule of the restart,
   * inside the company of the request only: an agent, a project or a customer that is not of
   * this company counts 0. Nothing is written.
   */
  app.get('/api/waiting-work', async (request, reply): Promise<WaitingWorkResponse> =>
    runner.withCompany(request, reply, FOUNDER, async ({ client }) => {
      const query = waitingWorkQuerySchema.safeParse(request.query);
      if (!query.success) {
        throw invalidRequest();
      }
      const scope =
        'agent' in query.data
          ? { agentCode: query.data.agent }
          : 'project' in query.data
            ? { projectId: query.data.project }
            : { customerId: query.data.customer };
      return waitingWorkResponseSchema.parse({ waiting: await countWaitingWork(client, scope) });
    }),
  );
}
