import {
  agentRunJobSchema,
  agentStep,
  dueDaySql,
  setContext,
  withContext,
  type AgentContext,
  type AgentRunJob,
  type AgentRunSender,
  type Queryable,
} from '@agent-office/db';
import {
  COORDINATOR_AGENT_CODE,
  costOf,
  officeDay,
  storedCardSchema,
  toolKindSchema,
  type ModelProfile,
  type StoredCard,
  type TokenUsage,
} from '@agent-office/shared';
import type pg from 'pg';
import {
  ModelCallError,
  type CallModel,
  type ModelMessage,
  type ModelRequest,
  type ModelTool,
  type ModelTurn,
  type ToolResult,
  type ToolUse,
} from '../model/client.ts';
import { gateToolCall, type CatalogTool } from './gate.ts';
import {
  dataText,
  systemText,
  type PromptData,
  type Revision,
  type UnitForRouting,
} from './prompt.ts';
import {
  HANDLED_TOOLS,
  ROUTE_TASK,
  SUBMIT_FOR_APPROVAL,
  inputProblems,
  modelTool,
  routeTaskInput,
  submitForApprovalInput,
} from './tools.ts';

/**
 * One agent run, from the job to the last record (KALAN-ISLER 1.1, the first slice).
 *
 * The job is a hint and the database is the authority: the runner takes the company and the agent
 * from the job and asks the database in whose name and in which project the run goes (8 October
 * decision 45; office.request_run_gate), and reads everything again with the worker's restricted
 * role. Rule 9: the context stays the same for the whole run; every database step is its own
 * short transaction that sets the context again (agentStep), and no transaction is open while the
 * model is called. Rule 5: the run row is written when the run opens, after every model
 * call (tokens and cost) and when it ends; every tool call has its own row and its audit row.
 *
 * Nothing here sets the status of the request: the records the run writes (a run, a routing, an
 * approval) move it inside the database.
 *
 * A project can carry an AI spending limit (8 October decision 17). While it is reached no run
 * is opened in that project (no run row, no model call; the job is refused with its reason, and
 * the database refuses the row behind the runner). A run that is open when the limit is reached
 * uses the answer it has already paid for (its tool call is executed) and ends before its next
 * model call, stopped with the code spending_limit_reached. When the founder raises the limit or
 * takes it away, the work it held starts again by itself (11 October decision 1): the refusal
 * and the stop are therefore written behind the lock a restart takes, as for a stopped agent.
 */

export type RunOutcome =
  // No run was opened.
  | 'job_invalid'
  | 'no_card_version'
  | 'card_invalid'
  | 'agent_not_enabled'
  | 'task_not_visible'
  | 'ai_not_allowed'
  // The AI spending limit of the request's project is reached (8 October decision 17).
  | 'spending_limit_reached'
  | 'request_closed'
  | 'job_stale'
  | 'duplicate_job'
  // A run was opened and closed without a model call.
  | 'card_not_runnable'
  | 'model_unavailable'
  // A run ended.
  | 'routed'
  // The coordinator named a unit where no open agent could take the work: the routing returned
  // the request to its requester and closed it (8 October decision 2).
  | 'returned'
  | 'submitted'
  | 'no_routing'
  | 'no_submission'
  | 'limit_reached'
  | 'stopped'
  | 'failed';

export interface RunResult {
  outcome: RunOutcome;
  runId: string | null;
  modelCalls: number;
}

export interface RunnerDeps {
  // Pool of the worker's restricted role (office_worker).
  pool: pg.Pool;
  // null: no model is configured (no key). Runs then end at once with "model_unavailable".
  callModel: CallModel | null;
  // Puts the unit agent's run on the queue in the transaction of the routing.
  jobs: AgentRunSender;
  // Codes and ids only: never a prompt, an answer or a key (rule 6).
  log: (event: string, fields: Record<string, string | number | null>) => void;
  now?: () => number;
  // A shorter limit for one model call than the time the run has left. Not set by the worker: a
  // call gets the run's remaining time, so that a slow answer is waited for once, until the run's
  // own deadline, instead of being cut and sent again.
  perCallTimeoutMs?: number;
}

// What a model wrote when it ended without its tool is kept with the run's raw content
// (runs.output, under the retention period), up to this size.
const FINAL_TEXT_MAX = 20_000;

/**
 * The run's summary is a sentence made by code, never a model's text: every reader of the request
 * reads it, and nothing an agent wrote reaches anybody but the approver before it is approved
 * (7 October decision 4). The same sentence for a run that ended without its tool and for a
 * coordinator that said through its tool that the request fits no unit: for the person the two are
 * one thing, a request nobody routed.
 */
const ENDED_WITHOUT_RESULT = {
  coordinator: 'Koordinasyon merkezi talebi yönlendirmeden çalışmasını bitirdi.',
  agent: 'Ajan sonucu onaya sunmadan çalışmasını bitirdi.',
} as const;

/**
 * Sent once when a turn ends in text although no result was stored: a tool cannot be forced on a
 * run that thinks, and the provider's own guidance is to check that the call was made and ask again.
 * The runner's own words, in a block of their own that no data block can imitate (dataBlock
 * escapes every "<").
 *
 * Two texts, because the two kinds of run end differently. A unit agent that cannot do the work
 * says so in prose and does not call its tool. The coordinator never ends in prose: "no unit fits"
 * is an answer of its tool too (an empty unit), so its reminder asks for the tool and nothing else.
 */
const notice = (body: string): string => `<runner_notice>\n${body}\n</runner_notice>`;
const REMINDER = {
  coordinator: notice(
    'Çalışman bitiş aracı çağrılmadan sona erdi; yazdığın metin kaydedilmedi. Yönlendirme kararın yalnızca `route_task` aracıyla kaydedilir; şimdi bitiş aracını çağır. Talep hiçbir birime oturmuyorsa ya da hangi birimin işi olduğu anlaşılmıyorsa aracı yine çağır: unit_code ve agent_code boş metin ("") olsun, nedenini reason alanına yaz. Düz metinle yanıt verme.',
  ),
  agent: notice(
    'Çalışman bitiş aracı çağrılmadan sona erdi; yazdığın metin kaydedilmedi. Sonuç yalnızca bitiş aracınla kaydedilir. Sonucu sunacaksan şimdi bitiş aracını çağır. İşi yapamıyorsan aracı çağırma; nedenini bir iki cümleyle yeniden yaz.',
  ),
} as const;

/**
 * What the model is told with a refused tool call, by refusal code: the common rules promise that
 * a result with "ok: false" says in "problems" what to correct. Fixed sentences; nothing of the
 * input is repeated. A refused input has sentences of its own (inputProblems).
 */
const ONLY_GIVEN_TOOLS = 'yalnızca sana verilen araçları kullan';
// The third way of route_task: a refused unit must not push the coordinator, which has to answer
// through its tool, toward some other unit when in truth none fits.
const NO_UNIT_FITS =
  'talep hiçbir birime oturmuyorsa unit_code ve agent_code boş metin ("") olmalı';
const REFUSAL_PROBLEMS: Readonly<Record<string, string>> = {
  unit_not_routable: `unit_code, agent_code: kendi birimine ya da kendine yönlendiremezsin; units_and_agents bloğundaki başka bir birimi seç; ${NO_UNIT_FITS}`,
  unit_or_agent_not_available: `unit_code, agent_code: units_and_agents bloğundaki bir birim ve o birimin orada yazan ajanlarından biri olmalı; birimde uygun ajan yoksa agent_code boş metin ("") olmalı; ${NO_UNIT_FITS}`,
  parallel_call_refused:
    'Bir yanıtta yalnızca ilk araç çağrısı işlenir; bu çağrı çalıştırılmadı. Gerekiyorsa sonraki yanıtında yeniden çağır',
  tool_not_in_catalog: `Böyle bir araç yok; ${ONLY_GIVEN_TOOLS}`,
  tool_not_on_card: `Bu araç görev kartında yok; ${ONLY_GIVEN_TOOLS}`,
  tool_not_built: `Bu araç bu sürümde kullanılamıyor; ${ONLY_GIVEN_TOOLS}`,
  approval_path_not_built: `Bu araç bu sürümde kullanılamıyor; ${ONLY_GIVEN_TOOLS}`,
};

interface CardVersion {
  id: string;
  model: string;
  stored: StoredCard;
}

interface TaskRow {
  title: string;
  description: string | null;
  status: string;
  requester_user_id: string;
  // The name of the request's project; null when it is inside none.
  project_name: string | null;
  // The due day of the request (YYYY-MM-DD, office time); null when the requester gave none.
  due_date: string | null;
  ai_allowed: boolean;
  company_name: string;
  requester_role: string | null;
  routed: boolean;
  step_id: string | null;
  step_agent_code: string | null;
  // Set when a person corrected the routing to this step; the note is that person's.
  step_corrected: boolean;
  step_note: string | null;
}

type MoneySource = 'card' | 'agent' | 'default';

/**
 * The marks of the latest earlier result of the step this run works on. A later result of the
 * same step cannot take them back (5 October decision 2; the database refuses it), however the
 * work came back: after the approver's change request or after the requester's.
 */
interface CarriedMarks {
  money: boolean;
  moneyBy: MoneySource | null;
  external: boolean;
}

const NOTHING_CARRIED: CarriedMarks = { money: false, moneyBy: null, external: false };

function moneySource(value: string | null): MoneySource | null {
  return value === 'card' || value === 'agent' || value === 'default' ? value : null;
}

/** A tool call the handler refused; the model is told why and may correct itself. */
class ToolRefusal extends Error {
  readonly code: string;
  // Which field broke which limit: fixed sentences, never a part of the input.
  readonly problems: readonly string[];

  constructor(code: string, problems: readonly string[] = []) {
    super(code);
    this.code = code;
    this.problems = problems;
  }
}

/**
 * Thrown inside the opening transaction to give it up: the step of the request changed between
 * the first read and the insert of the run.
 */
class StepMoved extends Error {}

// The company's restart lock, shared. office.restart_waiting_work takes the same key exclusively
// (8 October decision 49): what a runner writes while it holds this lock is either committed
// before a restart picks its work, or written after the opening of that restart is committed.
const RESTART_LOCK_SHARED = `select pg_advisory_xact_lock_shared(
  hashtextextended('office.restart:' || ($1::uuid)::text, 0))`;

// Is the AI spending limit of this project reached now (8 October decision 17): the database's
// own answer for an agent run, a yes or a no. The runner asks at the start of a run and after
// every model call, and reads anything but "no" as reached.
const SPENDING_LIMIT_REACHED = 'select office.project_spending_limit_reached($1) as reached';

function sqlState(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

async function loadCard(
  pool: pg.Pool,
  agentCode: string,
): Promise<CardVersion | 'none' | 'invalid'> {
  // Global tables: readable without a context, and they hold no company data.
  const { rows } = await pool.query<{ id: string; model: string; content: unknown }>(
    `select v.id, v.model, v.content
     from office.agent_definitions d
     join office.card_versions v on v.id = d.current_version_id
     where d.code = $1`,
    [agentCode],
  );
  const row = rows[0];
  if (!row) {
    return 'none';
  }
  const stored = storedCardSchema.safeParse(row.content);
  return stored.success ? { id: row.id, model: row.model, stored: stored.data } : 'invalid';
}

/**
 * What the gate decides with. The rows of the card's own tools come from the card version: the
 * kind and the approval rule a run was gated with are the ones its version holds, whatever the
 * catalog table says by now. The table (written in place by every sync) is read for the other
 * tools only, so that a call of a tool that is not on the card is refused as such and recorded by
 * its name.
 */
async function loadCatalog(pool: pg.Pool, stored: StoredCard): Promise<Map<string, CatalogTool>> {
  const { rows } = await pool.query<{
    name: string;
    kind: string;
    approval_rule: string | null;
  }>('select name, kind, approval_rule from office.tools');
  const catalog = new Map<string, CatalogTool>(
    rows.map((row) => [
      row.name,
      {
        name: row.name,
        kind: toolKindSchema.parse(row.kind),
        approvalRule: row.approval_rule,
      },
    ]),
  );
  for (const tool of stored.tools) {
    catalog.set(tool.name, {
      name: tool.name,
      kind: tool.kind,
      approvalRule: tool.approval_rule ?? null,
    });
  }
  return catalog;
}

async function audit(
  client: Queryable,
  event: string,
  fields: {
    runId?: string | null;
    tool?: string | null;
    recordType?: string;
    recordId?: string;
  } = {},
): Promise<void> {
  await client.query(
    // The project of the run's context is the label of its trace (rule 5).
    `insert into office.audit_log
       (company_id, project_id, event, tool_name, record_type, record_id, run_id)
     values (office.ctx_company_id(), office.ctx_project_id(), $1, $2, $3, $4, $5)`,
    [
      event,
      fields.tool ?? null,
      fields.recordType ?? null,
      fields.recordId ?? null,
      fields.runId ?? null,
    ],
  );
}

function usageOf(message: ModelMessage): TokenUsage {
  const usage = message.usage;
  const written = usage.cache_creation_input_tokens ?? 0;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    // Input that was neither read from nor written to the cache; the three are counted apart.
    input: usage.input_tokens,
    // Thinking tokens are inside this number.
    output: usage.output_tokens,
    cacheWrite5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(written - oneHour, 0),
    cacheWrite1h: oneHour,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
}

function finalText(message: ModelMessage): string | null {
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    // What PostgreSQL cannot hold is dropped before the text is stored.
    .replaceAll('\u0000', '')
    .toWellFormed()
    .trim();
  return text === '' ? null : text.slice(0, FINAL_TEXT_MAX).toWellFormed();
}

/**
 * Runs one job. Never throws for anything a job, a card, the model or the request can cause.
 * `onRunOpened` is told the id of the run this job opened, so that the caller can close exactly
 * that run if the runner itself fails.
 */
export async function runAgentJob(
  deps: RunnerDeps,
  rawJob: unknown,
  onRunOpened?: (runId: string) => void,
): Promise<RunResult> {
  const none = (outcome: RunOutcome): RunResult => ({ outcome, runId: null, modelCalls: 0 });
  const parsedJob = agentRunJobSchema.safeParse(rawJob);
  if (!parsedJob.success) {
    deps.log('run_refused', { reason: 'job_invalid' });
    return none('job_invalid');
  }
  const job: AgentRunJob = parsedJob.data;
  // Neither the person nor the project is the job's to say (8 October decision 45; rule 9): the
  // database names both (office.request_run_gate). From the opening on they stay for every step
  // of the run. Until the gate has answered, the person is the requester the job names.
  const context: AgentContext = {
    companyId: job.companyId,
    userId: job.userId,
    agentCode: job.agentCode,
    projectId: null,
  };
  interface Gate {
    run_as: string | null;
    project_id: string | null;
    ai_allowed: boolean;
  }
  /** A transaction that starts with the company and the agent and no person: the gate names one. */
  const unresolved = <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
    withContext(deps.pool, { companyId: job.companyId, agentCode: job.agentCode }, fn);
  /**
   * Asks the database in whose name and in which project a run on this request goes, and sets
   * both in the open transaction and in the run's context. Null: no request of this company.
   */
  const resolve = async (client: pg.PoolClient): Promise<Gate | null> => {
    const { rows } = await client.query<Gate>(
      'select run_as, project_id, ai_allowed from office.request_run_gate($1)',
      [job.taskId],
    );
    const gate = rows[0];
    if (gate === undefined || gate.run_as === null) return null;
    context.userId = gate.run_as;
    context.projectId = gate.project_id;
    await setContext(client, context);
    return gate;
  };
  const coordinator = job.agentCode === COORDINATOR_AGENT_CODE;
  const now = deps.now ?? Date.now;
  const refuse = async (outcome: RunOutcome): Promise<RunResult> => {
    deps.log('run_refused', { reason: outcome, task: job.taskId, agent: job.agentCode });
    // The trace of a run that was not opened, in the name and the project the database resolves:
    // it is written also when the requester can no longer write anything (the trace is what a
    // restart reads, 8 October decision 49). Nothing is written when there is no such request
    // for this company; a failure is silent.
    await unresolved(async (client) => {
      if ((await resolve(client)) !== null) {
        await audit(client, 'run_refused', { recordType: 'task', recordId: job.taskId });
      }
    }).catch(() => undefined);
    return none(outcome);
  };
  /**
   * The trace of a job that was refused because its agent is stopped, agents may not work in its
   * project, or the project's AI spending limit is reached. The restart reads this trace
   * (8 October decision 49; 11 October decision 1 for a raised limit), so it is never written
   * past an opening: the transaction asks the gate again (its row locks hold a change of the
   * permission or of the limit off until this transaction ends), takes the company's restart
   * lock shared (office.restart_waiting_work takes the same key exclusively) and reads the
   * switch and the limit again. Still closed: the trace is written, and an opening that waited
   * behind this transaction finds it. Open now: nothing is written, and the caller opens the
   * job again.
   *
   * The order is fixed: the gate, then the advisory lock, then the switch. (The gate takes row
   * locks an opening of a permission also takes; the advisory lock taken before the gate could
   * wait for an opening that waits for this transaction's row lock.)
   */
  const recordSwitchRefusal = (): Promise<'recorded' | 'open_now'> =>
    unresolved(async (client): Promise<'recorded' | 'open_now'> => {
      const gate = await resolve(client);
      if (gate === null) return 'recorded';
      await client.query(RESTART_LOCK_SHARED, [job.companyId]);
      const agentSwitch = await client.query<{ status: string }>(
        'select status from office.company_agents where agent_code = $1',
        [job.agentCode],
      );
      let limitHolds = false;
      if (gate.project_id !== null) {
        const limit = await client.query<{ reached: boolean | null }>(SPENDING_LIMIT_REACHED, [
          gate.project_id,
        ]);
        limitHolds = limit.rows[0]?.reached !== false;
      }
      if (agentSwitch.rows[0]?.status === 'enabled' && gate.ai_allowed && !limitHolds) {
        return 'open_now';
      }
      await audit(client, 'run_refused', { recordType: 'task', recordId: job.taskId });
      return 'recorded';
    }).catch((): 'recorded' => 'recorded');
  /**
   * A job that found nothing to do: the work it called for is already running or waiting, or the
   * request is closed. Not a missed start, so the trace has a name of its own (the request's page
   * reads "run_refused" as work that was called for and did not start).
   */
  const skip = async (outcome: RunOutcome): Promise<RunResult> => {
    deps.log('run_skipped', { reason: outcome, task: job.taskId, agent: job.agentCode });
    await unresolved(async (client) => {
      if ((await resolve(client)) !== null) {
        await audit(client, 'run_skipped', { recordType: 'task', recordId: job.taskId });
      }
    }).catch(() => undefined);
    return none(outcome);
  };

  // Before any company data is read: the card version and the catalog (global tables).
  const version = await loadCard(deps.pool, job.agentCode);
  if (version === 'none') return refuse('no_card_version');
  if (version === 'invalid') return refuse('card_invalid');
  const { card } = version.stored;
  const catalog = await loadCatalog(deps.pool, version.stored);
  const offered: ModelTool[] = card.tools
    .filter((name) => HANDLED_TOOLS.includes(name))
    .flatMap((name) => {
      const tool = modelTool(name);
      return tool ? [tool] : [];
    });
  // How the model is called and what it costs: the profile the card version holds.
  const profile: ModelProfile = version.stored.model;
  // The coordinator answers through its closing tool and nothing else: left to choose, the small
  // model it runs on ended about every second run in prose, and such a request falls to the
  // founder while its requester learns nothing. Only where the profile sends no thinking.
  const forcedTool =
    coordinator &&
    profile.thinking !== 'adaptive' &&
    offered.some((tool) => tool.name === ROUTE_TASK)
      ? ROUTE_TASK
      : null;

  // Gate and open the run: one transaction. It starts with the company and the agent and no
  // person; the gate names the person and the project, and the rest runs in that context.
  type Opened =
    | { kind: 'refused'; outcome: RunOutcome }
    | { kind: 'closed'; outcome: RunOutcome; runId: string }
    | {
        kind: 'open';
        runId: string;
        // The step the run was opened for, as the database wrote it; null for the coordinator.
        stepId: string | null;
        data: PromptData;
        previousApprovalId: string | null;
        carried: CarriedMarks;
      };
  // Runs of this agent that were still open for a step that has since been replaced.
  const superseded: string[] = [];
  const openRun = async (client: pg.PoolClient): Promise<Opened> => {
    // Two jobs for one request wait for each other here.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [job.taskId]);
    // In whose name the run goes (8 October decision 45), its project context (docs/SONRA.md
    // W-g) and rule 12 (the runner checks at the start of every run): the database is asked,
    // inside this transaction. This transaction began with the company and the agent and no
    // person; from here on its context, and the context of every later step, carries the person
    // and the project the gate named. The answer about the permission is locked until the run
    // row is committed, so a permission that is closed at this moment either is read here or
    // finds the run and closes it. The person is not locked: if it changes before the insert,
    // the insert is refused (office.check_run_request) and the opening is read again (below).
    const gated = await resolve(client);
    if (gated === null) return { kind: 'refused', outcome: 'task_not_visible' };
    // The stop switch (rule: a stopped agent takes no new work).
    const agentSwitch = await client.query<{ status: string }>(
      'select status from office.company_agents where agent_code = $1',
      [job.agentCode],
    );
    if (agentSwitch.rows[0]?.status !== 'enabled') {
      return { kind: 'refused', outcome: 'agent_not_enabled' };
    }
    // A refusal here leaves no run and calls no model. The ai_allowed column of the read below
    // stays as the runner's own guard behind the gate and the policies.
    if (!gated.ai_allowed) return { kind: 'refused', outcome: 'ai_not_allowed' };
    const found = await client.query<TaskRow>(
      `select t.title, t.description, t.status, t.requester_user_id,
              (select p.name from office.projects p where p.id = t.project_id) as project_name,
              ${dueDaySql('t.due_at')} as due_date,
              (
                t.project_id is null or exists (
                  select 1 from office.projects p
                  where p.id = t.project_id and p.ai_allowed
                    and (p.customer_id is null or exists (
                      select 1 from office.customers c where c.id = p.customer_id and c.ai_allowed
                    ))
                )
              ) as ai_allowed,
              co.name as company_name,
              office.my_role() as requester_role,
              exists (select 1 from office.task_routings r where r.task_id = t.id) as routed,
              s.id as step_id,
              s.agent_code as step_agent_code,
              coalesce(s.routed_by_user_id is not null, false) as step_corrected,
              case when s.routed_by_user_id is not null then s.reason end as step_note
       from office.tasks t
       join office.companies co on co.id = t.company_id
       left join office.task_routings s on s.task_id = t.id and s.status = 'active'
       where t.id = $1 and t.kind = 'request'`,
      [job.taskId],
    );
    const task = found.rows[0];
    if (!task) return { kind: 'refused', outcome: 'task_not_visible' };
    if (!task.ai_allowed) return { kind: 'refused', outcome: 'ai_not_allowed' };
    if (task.status === 'done' || task.status === 'cancelled') {
      return { kind: 'refused', outcome: 'request_closed' };
    }
    // The job names the requester: who asked. In whose name the run goes is the gate's answer,
    // which may be the founder (decision 45); a job that names anybody else as the requester is
    // not this request's job.
    if (task.requester_user_id !== job.userId) return { kind: 'refused', outcome: 'job_stale' };
    if (task.requester_role !== 'founder' && task.requester_role !== 'employee') {
      return { kind: 'refused', outcome: 'job_stale' };
    }
    if (coordinator ? task.routed : task.step_agent_code !== job.agentCode) {
      // The coordinator routes once; a unit agent works only on a request routed to it now.
      return { kind: 'refused', outcome: coordinator ? 'duplicate_job' : 'job_stale' };
    }
    // A run belongs to the step it was opened for (7 October decision 7: routing again starts the
    // agent's work again). An open run of the step that is active now is this very work: the job
    // is a duplicate. An open run of a step that gave way to a new routing, also one to the same
    // agent, never read what the new step carries and cannot submit any more: it is closed here,
    // and the new run opens. This is also what ends a run a dead worker left open, once a person
    // routes the request again.
    const running = await client.query<{ id: string; routing_id: string | null }>(
      `select id, routing_id from office.runs
       where task_id = $1 and agent_code = $2 and status = 'running'
       order by started_at, id`,
      [job.taskId, job.agentCode],
    );
    if (running.rows.some((run) => run.routing_id === task.step_id)) {
      return { kind: 'refused', outcome: 'duplicate_job' };
    }
    for (const stale of running.rows) {
      await client.query(
        `update office.runs set status = 'stopped', finished_at = now(),
           error_code = 'routing_changed'
         where id = $1 and status = 'running'`,
        [stale.id],
      );
      await audit(client, 'run_stopped', {
        runId: stale.id,
        recordType: 'task',
        recordId: job.taskId,
      });
      superseded.push(stale.id);
    }

    // A second attempt: what was written before and what the person asked to change. Only the
    // results of the step that is active now count: a step a person routed again starts fresh.
    let revision: Revision | undefined;
    let previousApprovalId: string | null = null;
    let carried = NOTHING_CARRIED;
    if (!coordinator) {
      const last = await client.query<{
        id: string;
        status: string;
        attempt: number;
        payload: unknown;
        rejection_reason: string | null;
        decision_reason: string | null;
        invalidated_at: Date | null;
        involves_money: boolean;
        goes_external: boolean;
        money_stated_by: string | null;
      }>(
        `select a.id, a.status, a.attempt, a.payload, a.rejection_reason, a.decision_reason,
                a.invalidated_at, a.involves_money, a.goes_external,
                a.payload ->> 'money_stated_by' as money_stated_by
         from office.approvals a
         where a.task_id = $1 and a.agent_code = $2 and a.routing_id = $3
         order by a.created_at desc, a.id desc
         limit 1`,
        [job.taskId, job.agentCode, task.step_id],
      );
      const result = last.rows[0];
      if (result) {
        // Whatever became of that result: the next one of this step is compared with it.
        carried = {
          money: result.involves_money,
          moneyBy: moneySource(result.money_stated_by),
          external: result.goes_external,
        };
      }
      if (result?.status === 'pending' && result.invalidated_at === null) {
        // Already submitted and waiting.
        return { kind: 'refused', outcome: 'duplicate_job' };
      }
      if (result?.status === 'changes_requested') {
        if (result.attempt >= 2) {
          // 2 October decision 10: after the second change request the work falls to a person.
          return { kind: 'refused', outcome: 'job_stale' };
        }
        previousApprovalId = result.id;
        revision = {
          askedBy: 'approver',
          reason: result.rejection_reason ?? 'other',
          note: result.decision_reason,
          previousOutput: result.payload,
        };
      } else if (result?.status === 'approved') {
        const asked = await client.query<{
          rejection_reason: string | null;
          decision_reason: string | null;
        }>(
          `select q.rejection_reason, q.decision_reason from office.requester_approvals q
           where q.task_id = $1 and q.approval_id = $2 and q.status = 'changes_requested'`,
          [job.taskId, result.id],
        );
        const answer = asked.rows[0];
        if (!answer) return { kind: 'refused', outcome: 'job_stale' };
        revision = {
          askedBy: 'requester',
          // The requester is not asked for a reason class; their own words are the note.
          reason: answer.rejection_reason ?? 'other',
          note: answer.decision_reason,
          previousOutput: result.payload,
        };
      }
    }

    let units: UnitForRouting[] | undefined;
    if (coordinator) {
      // Every unit of the company except the coordinator's own, with the agents that are enabled
      // now and one line of each card's purpose.
      const rows = await client.query<{
        unit: string;
        unit_name: string;
        agent: string | null;
        agent_name: string | null;
        purpose: string | null;
      }>(
        `select u.code as unit, u.name as unit_name, a.code as agent, a.name as agent_name,
                v.content -> 'card' ->> 'purpose' as purpose
         from office.companies c
         join office.units u on (u.company_code is null or u.company_code = c.code)
         left join (
           office.agent_definitions a
           join office.company_agents ca on ca.agent_code = a.code and ca.status = 'enabled'
           -- Only an agent with a card version can run: the others are not offered.
           join office.card_versions v on v.id = a.current_version_id
         ) on a.unit_code = u.code and ca.company_id = c.id
         where c.id = office.ctx_company_id() and u.code <> $1
         order by u.code collate "C", a.code collate "C"`,
        [card.unit],
      );
      units = [];
      for (const row of rows.rows) {
        let unit = units.at(-1);
        if (unit?.unit !== row.unit) {
          unit = { unit: row.unit, name: row.unit_name, agents: [] };
          units.push(unit);
        }
        if (row.agent !== null) {
          unit.agents.push({
            code: row.agent,
            name: row.agent_name ?? row.agent,
            purpose: (row.purpose ?? '').replace(/\s+/g, ' ').trim(),
          });
        }
      }
    }

    // Decision 17: no run starts in a project whose AI spending limit is reached. Asked in this
    // transaction, behind the gate's lock on the project row: a change of the limit waits until
    // the run row is committed. Asked here, directly before the insert and after every test
    // that answers a job with nothing to do (a closed request, a stale or a duplicate job): such
    // a job keeps its own answer and its own trace. No answer (the function gives none to a
    // context it does not know) is read as reached: a limit that cannot be read holds.
    if (gated.project_id !== null) {
      const limit = await client.query<{ reached: boolean | null }>(SPENDING_LIMIT_REACHED, [
        gated.project_id,
      ]);
      if (limit.rows[0]?.reached !== false) {
        return { kind: 'refused', outcome: 'spending_limit_reached' };
      }
    }

    const inserted = await client.query<{ id: string; routing_id: string | null }>(
      `insert into office.runs
         (company_id, task_id, agent_code, card_version_id, trigger_type, model, input)
       values (office.ctx_company_id(), $1, $2, $3, $4, $5, $6)
       returning id, routing_id`,
      [
        job.taskId,
        job.agentCode,
        version.id,
        coordinator ? 'request' : 'handoff',
        version.model,
        // Ids, the tool list and the limits; the request text stays on the request.
        JSON.stringify({
          tools: offered.map((tool) => tool.name),
          limits: card.limits,
          attempt: revision ? 'revision' : 'first',
        }),
      ],
    );
    const runId = inserted.rows[0]?.id;
    if (runId === undefined) {
      throw new Error('The run could not be opened');
    }
    const stepId = inserted.rows[0]?.routing_id ?? null;
    if (!coordinator && stepId !== task.step_id) {
      // A person routed the request again between the first read of this transaction and the
      // insert (a routing does not wait for a job). The database tied the run to the step that
      // is active now, and everything read above (the note, the earlier results, the marks) is
      // of the step before it. Nothing of this transaction is kept.
      throw new StepMoved();
    }
    await audit(client, 'run_started', { runId, recordType: 'task', recordId: job.taskId });

    // The card and the model must allow the run; if not, the run is closed where it was opened,
    // without a model call, so that the request's page can say why nothing happened.
    // A card on trial runs for the founder's own request only: not for a request the founder's
    // name merely stands in for (8 October decision 45).
    const ownRequest = context.userId === task.requester_user_id;
    const trialRefused =
      card.status === 'trial' && !(ownRequest && task.requester_role === 'founder');
    // The card says whether the agent runs inside a project (project_context). Only what the
    // first two cards need is built: "if_available" runs in the request's project when it has
    // one and without a project when it has none. A card without the field runs only on a
    // request without a project. "required" and "per_project" are not built yet: such a card
    // runs nothing.
    const projectServed =
      card.project_context === 'if_available' ||
      (card.project_context === undefined && (context.projectId ?? null) === null);
    const closeWith =
      card.status === 'draft' || trialRefused || offered.length === 0 || !projectServed
        ? 'card_not_runnable'
        : deps.callModel === null
          ? 'model_unavailable'
          : null;
    if (closeWith !== null) {
      await client.query(
        `update office.runs set status = 'failed', finished_at = now(), error_code = $2,
           output = $3 where id = $1`,
        [runId, closeWith, JSON.stringify({ outcome: closeWith, model_calls: 0 })],
      );
      await audit(client, 'run_failed', { runId, recordType: 'task', recordId: job.taskId });
      return { kind: 'closed', outcome: closeWith, runId };
    }
    return {
      kind: 'open',
      runId,
      stepId,
      previousApprovalId,
      carried,
      data: {
        facts: {
          company: task.company_name,
          requesterRole: task.requester_role,
          // The date the model is told as a fact: the office's day, not the UTC day (between
          // midnight and 03:00 in Türkiye the two differ, and "bugün" in a request means the
          // office's).
          today: officeDay(now()),
          agent: job.agentCode,
          // The name of the request's project: a fact of the request, data like the rest.
          ...(task.project_name !== null ? { project: task.project_name } : {}),
          // The requester's due day, as a fact of the request: data like the rest, no instruction
          // (docs/SONRA.md D-g). Left out when the request has none.
          ...(task.due_date !== null ? { dueDate: task.due_date } : {}),
        },
        request: { title: task.title, text: task.description ?? '' },
        ...(units ? { units } : {}),
        ...(!coordinator && task.step_corrected
          ? { routing: { correctedByPerson: true as const, note: task.step_note } }
          : {}),
        ...(revision ? { revision } : {}),
      },
    };
  };
  const open = (): Promise<Opened> =>
    unresolved(openRun).catch((error: unknown): Opened => {
      // The transaction was rolled back, and with it the closing of older runs.
      superseded.length = 0;
      // check_violation from the run's own triggers: the agent was stopped or the request closed
      // between the checks above and the insert.
      if (sqlState(error) === '23514') {
        return { kind: 'refused', outcome: 'job_stale' };
      }
      // program_limit_exceeded from the run's own check: the project's AI spending limit was
      // reached between the question above and the insert, by the cost another run of the
      // project committed in that instant (8 October decision 17). The database refused the row.
      if (sqlState(error) === '54000') {
        return { kind: 'refused', outcome: 'spending_limit_reached' };
      }
      // insufficient_privilege from the insert of the run: the person the gate named stopped
      // being the resolved one in this instant (or lost the project). Read again, once, like a
      // step that moved.
      if (sqlState(error) === '42501') throw new StepMoved();
      throw error;
    });
  // A step that moved under the opening is read again, once, from the start: the run then opens
  // for the new step, with what that step carries. If it moved a second time in that instant the
  // job gives way; the job of the newest routing starts the work. The same for a person who
  // stopped being the resolved one under the opening: the gate is asked anew.
  const openOnce = (): Promise<Opened> =>
    open().catch((error: unknown) => {
      if (!(error instanceof StepMoved)) throw error;
      return open().catch((again: unknown): Opened => {
        if (!(again instanceof StepMoved)) throw again;
        return { kind: 'refused', outcome: 'job_stale' };
      });
    });
  let opened = await openOnce();
  // A job that is refused in the instant its switch is opened (or the limit of its project is
  // raised): the opening's restart saw no trace of it, and a trace written afterwards would
  // leave the request at "çalışma başlamadı" with the agent open. The trace of these three
  // refusals is therefore written behind the locks an opening takes, after the switches and the
  // limit are read once more.
  let switchRefusalRecorded = false;
  if (
    opened.kind === 'refused' &&
    (opened.outcome === 'agent_not_enabled' ||
      opened.outcome === 'ai_not_allowed' ||
      opened.outcome === 'spending_limit_reached')
  ) {
    if ((await recordSwitchRefusal()) === 'open_now') {
      // The switch was opened in this instant and its restart saw no trace of this job: this job
      // is what starts the work. Once; a second refusal is written as any other.
      opened = await openOnce();
    } else {
      switchRefusalRecorded = true;
    }
  }

  for (const run of superseded) {
    deps.log('run_superseded', { run, task: job.taskId, agent: job.agentCode });
  }
  if (opened.kind === 'refused') {
    if (switchRefusalRecorded) {
      // The trace is written (above); only the log line and the answer are left.
      deps.log('run_refused', { reason: opened.outcome, task: job.taskId, agent: job.agentCode });
      return none(opened.outcome);
    }
    return opened.outcome === 'duplicate_job' || opened.outcome === 'request_closed'
      ? skip(opened.outcome)
      : refuse(opened.outcome);
  }
  onRunOpened?.(opened.runId);
  if (opened.kind === 'closed') {
    deps.log('run_closed', { run: opened.runId, reason: opened.outcome });
    return { outcome: opened.outcome, runId: opened.runId, modelCalls: 0 };
  }
  const { runId } = opened;
  const callModel = deps.callModel;
  if (callModel === null) {
    // Not reachable: the run was closed above. Kept for the types.
    return { outcome: 'model_unavailable', runId, modelCalls: 0 };
  }

  // The loop ----------------------------------------------------------------------------------------

  const deadline = now() + card.limits.duration_minutes * 60_000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => {
      controller.abort();
    },
    Math.max(deadline - now(), 0),
  );
  const system = systemText(
    version.stored,
    offered.map((tool) => tool.name),
  );
  const messages: ModelTurn[] = [
    { role: 'user', content: [{ type: 'text', text: dataText(opened.data) }] },
  ];
  const requestIds: string[] = [];
  // Every request that was sent to the provider, also the ones of a call that failed in the end
  // and the client's retries: model_calls counts answers, this counts sends.
  let modelSends = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let reminded = false;
  // The AI spending limit of the run's project was read as reached after a model call (decision
  // 17): the answer that was paid for is still used, and no further model call is made. (Set
  // inside a step of the run.)
  const spending = { limitReached: false };

  type EndStatus = 'completed' | 'failed' | 'limit_reached' | 'stopped';
  interface EndFields {
    errorCode?: string;
    summary?: string | null;
    stopReason?: string | null;
    // The model's closing words when it ended without its tool; raw content of the run.
    finalText?: string | null;
  }
  /** The end of the run, written inside an open step of the run. */
  const writeEnd = async (
    client: pg.PoolClient,
    status: EndStatus,
    outcome: RunOutcome,
    fields: EndFields,
  ): Promise<void> => {
    // Once: the status, the code and the summary of a run that is already closed stay.
    const closed = await client.query(
      `update office.runs set status = $2, finished_at = now(), error_code = $3, summary = $4,
         output = $5
       where id = $1 and status = 'running'`,
      [
        runId,
        status,
        fields.errorCode ?? null,
        fields.summary ?? null,
        JSON.stringify({
          outcome,
          stop_reason: fields.stopReason ?? null,
          model_calls: modelCalls,
          model_sends: modelSends,
          request_ids: requestIds,
          ...(fields.finalText ? { final_text: fields.finalText } : {}),
        }),
      ],
    );
    if ((closed.rowCount ?? 0) > 0) {
      await audit(client, `run_${status}`, { runId, recordType: 'task', recordId: job.taskId });
    } else {
      // Closed from elsewhere while this runner was working (the job of a new routing, a lost
      // run's handler, a closed AI permission): its status and its code stand. What this runner
      // sent is recorded with the run all the same, like its cost: every send reached the
      // provider.
      await client.query(
        `update office.runs set output = coalesce(output, '{}'::jsonb) || $2::jsonb
         where id = $1`,
        [
          runId,
          JSON.stringify({
            model_calls: modelCalls,
            model_sends: modelSends,
            request_ids: requestIds,
          }),
        ],
      );
    }
  };
  /** The log line and the answer of a run whose end is written. */
  const ended = (status: EndStatus, outcome: RunOutcome, code: string | null): RunResult => {
    deps.log('run_finished', { run: runId, status, outcome, code });
    return { outcome, runId, modelCalls };
  };
  const finish = async (
    status: EndStatus,
    outcome: RunOutcome,
    fields: EndFields = {},
  ): Promise<RunResult> => {
    await agentStep(deps.pool, context, (client) => writeEnd(client, status, outcome, fields));
    return ended(status, outcome, fields.errorCode ?? null);
  };

  /** A tool call that did not take effect: its own row, counted, and an error for the model. */
  const refused = async (
    block: ToolUse,
    status: 'failed' | 'blocked',
    code: string,
    problems: readonly string[] = [],
  ): Promise<ToolResult> => {
    const known = catalog.has(block.name);
    const fixed = REFUSAL_PROBLEMS[code];
    const told = problems.length > 0 ? problems : fixed === undefined ? [] : [fixed];
    await agentStep(deps.pool, context, async (client) => {
      if (known) {
        await client.query(
          `insert into office.tool_calls (company_id, run_id, seq, tool_name, status, error_code,
             finished_at)
           values (office.ctx_company_id(), $1, $2, $3, $4, $5, now())`,
          [runId, toolCalls, block.name, status, code],
        );
      }
      await client.query(
        'update office.runs set tool_call_count = tool_call_count + 1 where id = $1',
        [runId],
      );
      await audit(client, 'tool_refused', { runId, tool: known ? block.name : null });
    });
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify({
        ok: false,
        error_code: code,
        ...(told.length > 0 ? { problems: told } : {}),
      }),
      is_error: true,
    };
  };

  type Executed = { result: ToolResult; end: null } | { result: null; end: RunResult };

  const execute = async (block: ToolUse): Promise<Executed> => {
    toolCalls += 1;
    const decision = gateToolCall(
      { level: card.authority.level, tools: card.tools },
      catalog.get(block.name),
      block.name,
    );
    if (decision.kind === 'refuse') {
      return { result: await refused(block, 'blocked', decision.code), end: null };
    }
    if (decision.kind === 'to_approval' || !HANDLED_TOOLS.includes(block.name)) {
      // No tool of the first slice reaches the approval desk through the gate; a call that would
      // is never executed in its place.
      const code = decision.kind === 'to_approval' ? 'approval_path_not_built' : 'tool_not_built';
      return { result: await refused(block, 'blocked', code), end: null };
    }
    const seq = toolCalls;
    try {
      // One short transaction: the call's row, the write, the count, the audit row and, for a tool
      // that ends the run, the end of the run itself.
      const done = await agentStep(deps.pool, context, async (client) => {
        const call = await client.query<{ id: string }>(
          `insert into office.tool_calls (company_id, run_id, seq, tool_name, input)
           values (office.ctx_company_id(), $1, $2, $3, $4) returning id`,
          [runId, seq, block.name, JSON.stringify({ received: true })],
        );
        const callId = call.rows[0]?.id;
        let record: { type: string; id: string };
        let summary: string;
        let outcome: RunOutcome;
        let stored: Record<string, unknown>;
        // The coordinator's reason when it routed nothing: raw content of the run, stored where the
        // closing words of a run that ended without its tool are stored (output.final_text).
        let said: string | null = null;
        if (block.name === ROUTE_TASK) {
          const input = routeTaskInput.safeParse(block.input);
          if (!input.success) throw new ToolRefusal('invalid_input', inputProblems(input.error));
          const unitCode = input.data.unit_code === '' ? null : input.data.unit_code;
          const agent = input.data.agent_code === '' ? null : input.data.agent_code;
          // The coordinator never routes to its own unit or to itself.
          if (unitCode === card.unit || agent === job.agentCode) {
            throw new ToolRefusal('unit_not_routable');
          }
          record = { type: 'task', id: job.taskId };
          stored = { unit: unitCode, agent };
          if (unitCode === null) {
            // The request fits no unit, or it cannot be told whose work it is: nothing is routed
            // and no job is sent. The run ends as one that did not route, with the sentence every
            // reader of the request reads; the coordinator's reason is kept where the closing words
            // of a run that ended without its tool are kept, for the person who may decide.
            outcome = 'no_routing';
            summary = ENDED_WITHOUT_RESULT.coordinator;
            said = input.data.reason;
          } else {
            // Without an agent the database returns the request to its requester and closes it in
            // this same statement; the rest of this transaction is the trace of this run.
            await client.query('select office.route_request($1, $2::jsonb, $3)', [
              job.taskId,
              JSON.stringify([{ unit: unitCode, agent, reason: input.data.reason }]),
              runId,
            ]);
            if (agent !== null) {
              // The unit agent's run; stored with the routing. The job names the requester, as
              // every job does: in whose name that run goes is the gate's answer when it opens.
              await deps.jobs.send(client, {
                companyId: job.companyId,
                userId: job.userId,
                taskId: job.taskId,
                agentCode: agent,
              });
            }
            const unit = await client.query<{ name: string }>(
              'select name from office.units where code = $1',
              [unitCode],
            );
            const unitName = unit.rows[0]?.name ?? unitCode;
            outcome = agent === null ? 'returned' : 'routed';
            summary =
              agent === null
                ? `Talep ${unitName} birimine yönlendirildi; birimde işi alabilecek açık ajan olmadığı için talep sahibine geri çevrildi.`
                : `Talep ${unitName} birimine yönlendirildi; işi ${agent} yürütecek.`;
          }
        } else {
          const input = submitForApprovalInput.safeParse(block.input);
          if (!input.success) throw new ToolRefusal('invalid_input', inputProblems(input.error));
          // Money and "goes outside" are decided here, from the card; the model's word can raise
          // either for one output and can never lower it (the rule of the step-up migration). A
          // card that states nothing about money gets the safe side until the per output levels
          // are decided (M19): the result is opened as involving money.
          const stated: MoneySource | null =
            card.output_involves_money === true
              ? 'card'
              : input.data.involves_money
                ? 'agent'
                : card.output_involves_money === undefined
                  ? 'default'
                  : null;
          // Nor can a later result of the step lower what an earlier one carried: a text that was
          // reworked after "fiyatı çıkar" truthfully states no money, and is still stored with
          // the mark, so that approving it asks for the passkey as before. The mark keeps the
          // source it had.
          const { carried } = opened;
          const involvesMoney = stated !== null || carried.money;
          const moneyBy = stated ?? (carried.money ? carried.moneyBy : null);
          const basis = await client.query<{ version: number }>(
            'select version from office.tasks where id = $1',
            [job.taskId],
          );
          const approval = await client.query<{ id: string }>(
            `insert into office.approvals
               (company_id, task_id, run_id, agent_code, tool_name, title, summary,
                agent_rationale, risk_note, payload, options, basis_type, basis_id, basis_version,
                involves_money, goes_external, previous_approval_id)
             values (office.ctx_company_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'task', $1,
                $11, $12, $13, $14)
             returning id`,
            [
              job.taskId,
              runId,
              job.agentCode,
              SUBMIT_FOR_APPROVAL,
              input.data.title,
              input.data.summary,
              input.data.rationale,
              input.data.risk_note === '' ? null : input.data.risk_note,
              JSON.stringify({
                options: input.data.options,
                ...(moneyBy === null ? {} : { money_stated_by: moneyBy }),
              }),
              JSON.stringify(input.data.options.map((option) => ({ code: option.code }))),
              basis.rows[0]?.version ?? null,
              involvesMoney,
              // The card's word wins over the model's: outgoing work cannot be understated.
              input.data.goes_external || card.output_goes_external === true || carried.external,
              opened.previousApprovalId,
            ],
          );
          const approvalId = approval.rows[0]?.id ?? '';
          record = { type: 'approval', id: approvalId };
          outcome = 'submitted';
          summary = `Sonuç onaya sunuldu: ${String(input.data.options.length)} seçenek.`;
          // The id and the size, never the text: the run is read by people who may not read the
          // result before it is approved.
          stored = { approval_id: approvalId, options: input.data.options.length };
        }
        await client.query(
          `update office.tool_calls set status = 'succeeded', finished_at = now(), input = $2,
             result = $3 where id = $1`,
          [callId, JSON.stringify(stored), JSON.stringify({ ok: true })],
        );
        await client.query(
          `update office.runs set tool_call_count = tool_call_count + 1, status = 'completed',
             finished_at = now(), summary = $2, output = $3
           where id = $1 and status = 'running'`,
          [
            runId,
            summary,
            JSON.stringify({
              outcome,
              model_calls: modelCalls,
              model_sends: modelSends,
              request_ids: requestIds,
              ...(said === null ? {} : { final_text: said }),
            }),
          ],
        );
        await audit(client, 'tool_called', {
          runId,
          tool: block.name,
          recordType: record.type,
          recordId: record.id,
        });
        await audit(client, 'run_completed', { runId, recordType: 'task', recordId: job.taskId });
        return outcome;
      });
      deps.log('run_finished', { run: runId, status: 'completed', outcome: done, code: null });
      return { result: null, end: { outcome: done, runId, modelCalls } };
    } catch (error) {
      if (error instanceof ToolRefusal) {
        return { result: await refused(block, 'failed', error.code, error.problems), end: null };
      }
      const state = sqlState(error);
      if (block.name === ROUTE_TASK && state === '23514') {
        // The unit or the agent is not one this company can route to now; the model may choose
        // again within its limits.
        return { result: await refused(block, 'failed', 'unit_or_agent_not_available'), end: null };
      }
      let taken = false;
      if (block.name === SUBMIT_FOR_APPROVAL && state === '23505') {
        // Something already waits for approval on this request. Only when it is this run's own
        // result (an earlier attempt of this very call stored it) is the work submitted; a
        // waiting approval of another run means this result was not stored at all, and the run
        // must not be recorded as if it had been.
        const own = await agentStep(deps.pool, context, (client) =>
          client.query(
            `select 1 from office.approvals
             where run_id = $1 and status = 'pending' and invalidated_at is null`,
            [runId],
          ),
        );
        if (own.rows.length > 0) {
          return { result: null, end: await finish('completed', 'submitted') };
        }
        taken = true;
      }
      if (taken || state === '23514' || state === '42501' || state === 'P0002') {
        // The request was closed, routed elsewhere or cannot take this result any more.
        await refused(block, 'failed', 'request_changed');
        return {
          result: null,
          end: await finish('stopped', 'stopped', { errorCode: 'request_changed' }),
        };
      }
      throw error;
    }
  };

  try {
    for (;;) {
      if (toolCalls >= card.limits.tool_calls) {
        return await finish('limit_reached', 'limit_reached', { errorCode: 'tool_call_limit' });
      }
      const left = deadline - now();
      if (left <= 0 || controller.signal.aborted) {
        return await finish('limit_reached', 'limit_reached', { errorCode: 'time_limit' });
      }
      if (spending.limitReached) {
        // The answer that was paid for has been used: its tool call was executed, or the model
        // ended without one. One more model call would be needed, and the AI spending limit of
        // the project does not allow it (8 October decision 17).
        // A raise of the limit restarts the work of a run that is already stopped and passes
        // by a run that is still open (11 October decision 1), so the stop is written behind
        // the lock every restart of the company takes, after the limit is read once more, as
        // for a stopped agent below. Still reached: the run ends in this transaction, and a
        // raise that waits for the lock finds it stopped and starts the work again. Raised
        // meanwhile: its restart passed this open run by, and the run goes on.
        const stopped = await agentStep(deps.pool, context, async (client) => {
          await client.query(RESTART_LOCK_SHARED, [job.companyId]);
          const limit = await client.query<{ reached: boolean | null }>(SPENDING_LIMIT_REACHED, [
            context.projectId,
          ]);
          if (limit.rows[0]?.reached === false) return false;
          await writeEnd(client, 'stopped', 'stopped', { errorCode: 'spending_limit_reached' });
          return true;
        });
        if (stopped) return ended('stopped', 'stopped', 'spending_limit_reached');
        spending.limitReached = false;
      }
      const params: ModelRequest = {
        // From the card version, never a literal in code.
        model: version.model,
        max_tokens: profile.max_tokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: offered,
        // At most one tool call per turn. The coordinator's closing tool is the tool choice itself
        // where its profile sends no thinking; a forced tool cannot be combined with thinking, so
        // for every other run "end with your tool" is an instruction and the choice stays "auto".
        tool_choice:
          forcedTool === null
            ? { type: 'auto', disable_parallel_tool_use: true }
            : { type: 'tool', name: forcedTool, disable_parallel_tool_use: true },
        messages,
        ...(profile.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
        ...(profile.effort === null ? {} : { output_config: { effort: profile.effort } }),
      };
      let message: ModelMessage;
      try {
        const answer = await callModel(params, {
          signal: controller.signal,
          timeoutMs:
            deps.perCallTimeoutMs === undefined ? left : Math.min(left, deps.perCallTimeoutMs),
        });
        message = answer.message;
        modelSends += answer.sends;
        if (answer.requestId !== null) requestIds.push(answer.requestId);
      } catch (error) {
        if (!(error instanceof ModelCallError)) throw error;
        modelSends += error.sends;
        if (error.requestId !== null) requestIds.push(error.requestId);
        if (error.code === 'aborted' || now() >= deadline) {
          return await finish('limit_reached', 'limit_reached', { errorCode: 'time_limit' });
        }
        return await finish('failed', 'failed', {
          errorCode: error.code,
        });
      }
      modelCalls += 1;

      // After every model call: what it cost, and whether the run may go on. The database stops
      // an open run by itself only when an AI permission is closed (rule 12), so the switch, the
      // request, the step and the run's own status are read again here. The cost is written
      // whatever the run's status: a call that was answered is paid for, also when the run was
      // closed from elsewhere while the model was answering.
      const usage = usageOf(message);
      const paidFor = [
        runId,
        usage.input,
        usage.output,
        usage.cacheWrite5m + usage.cacheWrite1h,
        usage.cacheRead,
        costOf(usage, profile.prices),
      ];
      // Whether the numbers of this call reached the run (set inside the step below).
      const numbers = { recorded: true };
      // Whether the step below wrote the end of the run itself (a stopped agent).
      const end = { written: false };
      const goOn = await agentStep(deps.pool, context, async (client) => {
        const paid = await client.query(
          `update office.runs set input_tokens = input_tokens + $2,
             output_tokens = output_tokens + $3, cache_write_tokens = cache_write_tokens + $4,
             cache_read_tokens = cache_read_tokens + $5, cost_usd = cost_usd + $6::numeric
           where id = $1`,
          paidFor,
        );
        if ((paid.rowCount ?? 0) === 0) {
          // The run is hidden from this context. If an AI permission was closed while the model
          // was answering, the database stopped the run; it takes the numbers of this answered
          // call through its own narrow function (rule 5). False for a run that is hidden for
          // any other reason (its person lost the request: handed over below).
          const added = await client.query<{ ok: boolean }>(
            `select office.add_usage_to_stopped_run($1, $2, $3, $4, $5, $6::numeric) as ok`,
            paidFor,
          );
          // The database's own stop: the answer is dropped, and the log names the real reason.
          if (added.rows[0]?.ok === true) return 'ai_permission_closed';
          // Not a permission. If the person of this run is no longer the one the database
          // resolves for the request (8 October decision 45), the database closes the run here,
          // with the numbers of this answered call, and the same work is called for again in
          // this transaction: the new run opens in the name resolved now.
          const handed = await client.query<{ ok: boolean }>(
            `select office.hand_run_over($1, $2, $3, $4, $5, $6::numeric) as ok`,
            paidFor,
          );
          if (handed.rows[0]?.ok === true) {
            await deps.jobs.send(client, {
              companyId: job.companyId,
              userId: job.userId,
              taskId: job.taskId,
              agentCode: job.agentCode,
            });
            return 'identity_changed';
          }
          // Hidden for a reason neither function knows: nothing took the numbers.
          numbers.recorded = false;
        }
        // Decision 17: the limit of the run's project, read with the cost of this call in the
        // sum (the update above is in this transaction). No answer is read as reached.
        if ((context.projectId ?? null) !== null) {
          const limit = await client.query<{ reached: boolean | null }>(SPENDING_LIMIT_REACHED, [
            context.projectId,
          ]);
          spending.limitReached = limit.rows[0]?.reached !== false;
        }
        interface State {
          agent: string | null;
          task: string;
          step: string | null;
          routed: boolean;
          run: string | null;
          run_code: string | null;
        }
        const readState = async (): Promise<State | undefined> => {
          const state = await client.query<State>(
            `select (select ca.status from office.company_agents ca where ca.agent_code = $2) as agent,
                    t.status as task,
                    (select s.id from office.task_routings s
                     where s.task_id = t.id and s.status = 'active' and s.agent_code = $2) as step,
                    exists (select 1 from office.task_routings r where r.task_id = t.id) as routed,
                    (select r.status from office.runs r where r.id = $3) as run,
                    (select r.error_code from office.runs r where r.id = $3) as run_code
             from office.tasks t where t.id = $1`,
            [job.taskId, job.agentCode, runId],
          );
          return state.rows[0];
        };
        /** Why the run ends here, or null: it goes on with the answer it has. */
        const verdict = (row: State | undefined): string | null => {
          if (!row || row.task === 'done' || row.task === 'cancelled') return 'request_closed';
          // The run's own record. A run that was closed while the model was answering stays
          // closed, also when everything else reads as before: an AI permission that was closed
          // and opened again inside this one call left the run stopped and visible, and the
          // opening has called for the work again (8 October decision 49). The answer is dropped
          // with the code the run was closed with; the job of the restart does the work, once.
          if (row.run !== 'running') return row.run_code ?? 'run_closed';
          if (row.agent !== 'enabled') return 'agent_stopped';
          // The coordinator routes a request nobody has routed yet. Once a person gave it to a
          // unit while this run was open (7 October decision 7), the run has nothing left to
          // decide: it stops here, before its answer is looked at. The database refuses such a
          // routing too.
          if (coordinator) return row.routed ? 'routing_changed' : null;
          // A unit agent works for the step its run was opened for, not for whichever step names
          // its code now: a new routing to the same agent is a new step, with a note this run
          // never read.
          if (row.step === null || row.step !== opened.stepId) return 'routing_changed';
          return null;
        };
        const read = verdict(await readState());
        if (read !== 'agent_stopped') return read;
        // The agent is stopped. An opening of the agent restarts the work of a run that is
        // already stopped and passes by a run that is still open (decision 49), so the stop is
        // written here, behind the lock every restart of the company takes, and not in a later
        // step: an agent that is opened again between this read and that write would restart
        // nothing, and the request would read "ajan durduruldu" beside an open agent. Behind
        // the lock everything is read once more. Still stopped: the run ends in this
        // transaction, and an opening that waits for the lock finds it stopped. Open again: its
        // restart passed this open run by, and the run goes on with the answer it has.
        // The order is free of deadlocks: this transaction holds the run's row and no lock an
        // opening takes before the restart lock.
        await client.query(RESTART_LOCK_SHARED, [job.companyId]);
        const behindLock = verdict(await readState());
        if (behindLock === 'agent_stopped') {
          await writeEnd(client, 'stopped', 'stopped', { errorCode: 'agent_stopped' });
          end.written = true;
        }
        return behindLock;
      });
      if (!numbers.recorded) {
        // Hidden and neither stopped by a permission nor handed over: the numbers are kept in
        // the log at least. Numbers only, never text (rule 6).
        deps.log('run_usage_unrecorded', {
          run: runId,
          input: usage.input,
          output: usage.output,
          cost: costOf(usage, profile.prices),
        });
      }
      if (goOn !== null) {
        if (end.written) return ended('stopped', 'stopped', goOn);
        // For a run the database closed (a permission, a hand-over) this changes no row: the
        // status and the code the database wrote stand.
        return await finish('stopped', 'stopped', { errorCode: goOn });
      }

      switch (message.stop_reason) {
        case 'tool_use': {
          const results: ToolResult[] = [];
          let first = true;
          for (const block of message.content) {
            if (block.type !== 'tool_use') continue;
            // The limits hold inside one answer too: a turn with many calls cannot run past them.
            if (toolCalls >= card.limits.tool_calls) {
              return await finish('limit_reached', 'limit_reached', {
                errorCode: 'tool_call_limit',
              });
            }
            if (now() >= deadline) {
              return await finish('limit_reached', 'limit_reached', { errorCode: 'time_limit' });
            }
            if (!first) {
              // One tool call per turn was asked of the provider; the runner does not rely on it.
              toolCalls += 1;
              results.push(await refused(block, 'blocked', 'parallel_call_refused'));
              continue;
            }
            first = false;
            const executed = await execute(block);
            if (executed.end) return executed.end;
            results.push(executed.result);
          }
          // Append only: the assistant's turn goes back unchanged, then every result in one turn.
          messages.push({ role: 'assistant', content: message.content });
          messages.push({ role: 'user', content: results });
          break;
        }
        case 'end_turn':
          if (!reminded) {
            // Once: the turn goes back unchanged, then the runner's reminder (append only).
            reminded = true;
            messages.push({ role: 'assistant', content: message.content });
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: coordinator ? REMINDER.coordinator : REMINDER.agent },
              ],
            });
            break;
          }
          // The agent ended without its tool: it could not do the work and said why. Its words are
          // raw content of the run, read only by the person who may decide the work; the summary
          // everybody reads is the runner's own sentence.
          return await finish('completed', coordinator ? 'no_routing' : 'no_submission', {
            summary: coordinator ? ENDED_WITHOUT_RESULT.coordinator : ENDED_WITHOUT_RESULT.agent,
            stopReason: 'end_turn',
            finalText: finalText(message),
          });
        case 'refusal':
          return await finish('failed', 'failed', {
            errorCode: 'model_refusal',
            stopReason: message.stop_details?.category ?? 'refusal',
          });
        case 'max_tokens':
          // A tool call of a truncated turn is never executed.
          return await finish('failed', 'failed', { errorCode: 'output_truncated' });
        default:
          return await finish('failed', 'failed', {
            errorCode: 'unexpected_stop',
            stopReason: message.stop_reason,
          });
      }
    }
  } catch (error) {
    // A step failed. If agents may no longer work in the run's project, the database has stopped
    // the run (rule 12); if the run's person is no longer the one the database resolves, the run
    // is handed over (decision 45). Either way the run is hidden from this context and the
    // failure is that change meeting a step half way, not an error of the runner.
    const asked = await unresolved((client) =>
      client.query<Gate>('select run_as, project_id, ai_allowed from office.request_run_gate($1)', [
        job.taskId,
      ]),
    ).catch(() => null);
    const gateNow = asked?.rows[0];
    if (gateNow !== undefined && (context.projectId ?? null) !== null && !gateNow.ai_allowed) {
      deps.log('run_finished', {
        run: runId,
        status: 'stopped',
        outcome: 'stopped',
        code: 'ai_permission_closed',
      });
      return { outcome: 'stopped', runId, modelCalls };
    }
    if (gateNow !== undefined && gateNow.run_as !== null && gateNow.run_as !== context.userId) {
      const handed = await agentStep(deps.pool, context, async (client) => {
        // The usage of the last answered call was written before the step that failed.
        const over = await client.query<{ ok: boolean }>(
          'select office.hand_run_over($1, 0, 0, 0, 0, 0::numeric) as ok',
          [runId],
        );
        if (over.rows[0]?.ok !== true) return false;
        await deps.jobs.send(client, {
          companyId: job.companyId,
          userId: job.userId,
          taskId: job.taskId,
          agentCode: job.agentCode,
        });
        return true;
      }).catch(() => false);
      if (handed) {
        deps.log('run_finished', {
          run: runId,
          status: 'stopped',
          outcome: 'stopped',
          code: 'identity_changed',
        });
        return { outcome: 'stopped', runId, modelCalls };
      }
    }
    // Anything unforeseen still closes the run and leaves a trace; the error itself is rethrown
    // for the worker's log.
    await finish('failed', 'failed', { errorCode: 'runner_error' }).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// How long after its own time limit a run that is still open counts as lost: the time the runner
// needs to write its last records.
const LOST_AFTER_LIMIT_SECONDS = 60;

// The moment from which an open run counts as lost: its start, its own time limit (stored with the
// run when it was opened) and the margin above ($3).
const LOST_AT = `started_at + make_interval(secs => ($3::int + 60 * case
                   when jsonb_typeof(input -> 'limits' -> 'duration_minutes') = 'number'
                   then (input -> 'limits' ->> 'duration_minutes')::numeric
                   else 0
                 end)::double precision)`;

/**
 * A job that failed or expired without closing its run: the run it left open is closed as failed,
 * so that the request falls to a person instead of looking busy for ever.
 *
 * Only the run of that job is closed, never another one of the same request and agent: after a
 * new routing to the same agent a newer job has a healthy run of its own.
 *   { runId }   the runner itself failed (the worker's catch): the run that job opened, if any;
 *   'overdue'   the job reached the dead letter queue (the worker died or was stopped, nothing
 *               remembers the run's id): every open run of the request and agent whose own time
 *               limit, stored with the run when it was opened, has passed. A run that is still
 *               inside its limit may belong to a job that is alive, so it is left alone for now.
 *
 * Returns, for 'overdue', the seconds until the last run that is still open will have passed its
 * limit, or null when none is open. A job can reach the dead letter queue long before its run's
 * limit (a worker that is stopped fails its jobs at once), so the caller must look again then:
 * nothing else would ever close that run.
 */
export async function closeLostRun(
  deps: Pick<RunnerDeps, 'pool' | 'log'>,
  rawJob: unknown,
  which: { runId: string | null } | 'overdue',
): Promise<number | null> {
  const parsed = agentRunJobSchema.safeParse(rawJob);
  if (!parsed.success) return null;
  const job = parsed.data;
  if (which !== 'overdue' && which.runId === null) return null;
  // A run of a project request is visible only in its project's context, and a run whose
  // requester has left only to the person the database resolves now: the transaction starts
  // without a person and takes both from the gate.
  return withContext(
    deps.pool,
    { companyId: job.companyId, agentCode: job.agentCode },
    async (client) => {
      // In whose name and in which project the run of this request is seen now (decision 45).
      const gate = await client.query<{ run_as: string | null; project_id: string | null }>(
        'select run_as, project_id from office.request_run_gate($1)',
        [job.taskId],
      );
      const seenAs = gate.rows[0];
      // No request of this company any more: nothing of it can be seen or closed.
      if (seenAs === undefined || seenAs.run_as === null) return null;
      await setContext(client, {
        companyId: job.companyId,
        userId: seenAs.run_as,
        agentCode: job.agentCode,
        projectId: seenAs.project_id,
      });
      const closed =
        which === 'overdue'
          ? await client.query<{ id: string }>(
              `update office.runs set status = 'failed', finished_at = now(),
                 error_code = 'worker_lost'
               where task_id = $1 and agent_code = $2 and status = 'running'
                 and ${LOST_AT} <= now()
               returning id`,
              [job.taskId, job.agentCode, LOST_AFTER_LIMIT_SECONDS],
            )
          : await client.query<{ id: string }>(
              `update office.runs set status = 'failed', finished_at = now(),
                 error_code = 'worker_lost'
               where id = $3 and task_id = $1 and agent_code = $2 and status = 'running'
               returning id`,
              [job.taskId, job.agentCode, which.runId],
            );
      for (const row of closed.rows) {
        await audit(client, 'run_failed', {
          runId: row.id,
          recordType: 'task',
          recordId: job.taskId,
        });
        deps.log('run_lost', { run: row.id });
      }
      if (which !== 'overdue') return null;
      // What is still open is inside its limit (now() is the same moment for both statements).
      const open = await client.query<{ seconds: number | null }>(
        `select ceil(extract(epoch from max(${LOST_AT}) - now()))::int as seconds
         from office.runs
         where task_id = $1 and agent_code = $2 and status = 'running'`,
        [job.taskId, job.agentCode, LOST_AFTER_LIMIT_SECONDS],
      );
      const seconds = open.rows[0]?.seconds ?? null;
      return seconds === null ? null : Math.max(seconds, 1);
    },
  );
}
