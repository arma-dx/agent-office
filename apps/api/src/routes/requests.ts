import {
  agentToRunAgain,
  closeRequest,
  correctRouting,
  decideAcceptance,
  decideApproval,
  insertRequest,
  listAcceptances,
  listPendingAcceptances,
  listPendingApprovals,
  listRequests,
  listResultApprovals,
  listRoutingOptions,
  listRoutings,
  listRuns,
  listSteps,
  lockRequest,
  lockResultApproval,
  ownRequestExists,
  peopleNames,
  readIntake,
  readRequest,
  readResultApprovals,
  writeAudit,
  type AgentRunSender,
  type Queryable,
  type RequestRow,
} from '@agent-office/db';
import {
  COORDINATOR_AGENT_CODE,
  REQUEST_LIST_LIMIT,
  acceptanceDecisionSchema,
  approvalDecisionDetails,
  approvalDecisionSchema,
  approvalDeskSchema,
  closeRequestSchema,
  correctRoutingSchema,
  createRequestSchema,
  deriveRequestTitle,
  isClosedTaskStatus,
  officeDay,
  requestDetailSchema,
  requestIntakeSchema,
  requestListSchema,
  routingOptionsSchema,
  type ApprovalDesk,
  type RequestDetail,
  type RequestIntake,
  type RequestIntakeReason,
  type RequestList,
  type Role,
  type RoutingOptions,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CompanyContext } from '../db.ts';
import { ApiError, databaseErrorCode, invalidRequest, notFound } from '../errors.ts';
import { stepUpRequired, verifyStepUp } from '../passkeys.ts';
import {
  closureOf,
  optionsOf,
  peopleOf,
  peopleOfJourney,
  toApprovalCard,
  toJourney,
  toResult,
  toSummary,
  type Reader,
} from '../requests-view.ts';
import type { RouteDeps } from '../services.ts';

/**
 * Flow (A), "talep": a request that agents carry out (7 October decisions 1 to 8).
 *
 *   GET  /api/requests/intake                can this person send a request here now
 *   POST /api/requests                       a person writes what they want and, if they wish, a
 *                                            due day (information only); the coordinator's run is
 *                                            put on the queue in the same transaction
 *   GET  /api/requests                       the requests the person may read, with stage and turn
 *   GET  /api/requests/:requestId            one answer for the whole page
 *   POST /api/requests/:requestId/close      the requester cancels; the approver or founder stops
 *   GET  /api/requests/:requestId/routing-options  where it can be routed to now
 *   POST /api/requests/:requestId/routing    the founder or the approver corrects the routing; the
 *                                            agent's run is put on the queue in the same transaction
 *   POST /api/requests/:requestId/acceptance the requester's answer to the approved result
 *   GET  /api/approvals                      what waits for a decision of the person
 *   POST /api/approvals/:approvalId/decision the decision of the unit's approver
 *
 * No route sets a status or an approver, and no body has a field for one: the status follows the
 * records inside the database, and the database refuses every other writer. The one route that
 * names a unit and an agent is the correction of the routing, an act 7 October decision 7 gives to
 * the founder and the approver of the request; the database decides who may and appoints the
 * approver of the new step itself. A person always names an agent there: only the coordinator's
 * routing can find that a unit has no open agent, and such a request is returned to its requester
 * and closed (8 October decision 2), with no act left for anybody.
 * What a person reads is decided by the row policies; a record the person cannot see answers 404
 * exactly like one that does not exist, and so does the id of a task between people.
 *
 * An external person has no request (the run's identity must be an insider): every route here is
 * for the founder and employees.
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

// deadlock_detected: two transactions each held what the other needed and PostgreSQL ended this
// one. Every act of a person locks the request first, so two of them wait for each other; this is
// what is left for an order nobody foresaw. Answered as a conflict, never as a server error.
const DEADLOCK = '40P01';

const requestParams = z.object({ requestId: z.uuid() });
const approvalParams = z.object({ approvalId: z.uuid() });
const listQuery = z.object({ mine: z.enum(['true', 'false']).optional() });

const requestClosed = (): ApiError =>
  new ApiError(409, 'request_closed', 'Bu talep kapanmış. Sayfayı yenileyin.');

const actionNotAllowed = (): ApiError =>
  new ApiError(
    403,
    'action_not_allowed',
    'Bu işlemi yalnızca talep sahibi, birimin onaylayıcısı ya da kurucu yapabilir.',
  );

// The loser of a deadlock with another person's act on the same request (PostgreSQL 40P01). Which
// act won is not known here (the request may be closed, or routed again, or decided), so the
// sentence does not guess: the page is read again and says what happened.
const requestChanged = (): ApiError =>
  new ApiError(
    409,
    'request_changed',
    'Bu talep az önce değişti. Sayfayı yenileyip yeniden deneyin.',
  );

const approvalClosed = (): ApiError =>
  new ApiError(
    409,
    'approval_closed',
    'Bu onay kapanmış: karar verilmiş ya da dayandığı talep değişmiş. Sayfayı yenileyin.',
  );

const optionRequired = (): ApiError =>
  new ApiError(409, 'option_required', 'Onaylamak için seçeneklerden birini seçin.');

const privateSpace = (): ApiError =>
  new ApiError(409, 'private_space', 'Kurucu alanında talep açılamaz. Bir şirket seçin.');

const reasonRequired = (): ApiError =>
  new ApiError(
    409,
    'reason_required',
    'İşi durdurmak için bir neden yazın; talep sahibi bu nedeni okur.',
  );

const dueDatePast = (): ApiError =>
  new ApiError(
    409,
    'due_date_past',
    'Son tarih bugünden önce olamaz. Tarihi düzeltip yeniden gönderin.',
  );

const routingNotPossible = (): ApiError =>
  new ApiError(
    409,
    'routing_not_possible',
    'Bu birim ya da ajan şu an seçilemiyor. Listeyi yenileyip yeniden deneyin.',
  );

/** Why a request cannot be sent now, in the words the person reads. */
const INTAKE_MESSAGE: Record<RequestIntakeReason, string> = {
  private_space: 'Kurucu alanında talep açılamaz. Bir şirket seçin.',
  coordinator_closed: 'Koordinasyon merkezi bu şirkette açık değil; talep gönderilemedi.',
  coordinator_not_ready: 'Koordinasyon merkezi henüz çalışmaya hazır değil; talep gönderilemedi.',
  trial_founder_only:
    'Ajanlar deneme aşamasında; şimdilik yalnızca kurucunun talepleri çalışır. Talep gönderilemedi.',
};

/**
 * Can this person send a request in the context company now. A request that could never run is
 * refused at the door instead of being stored and left to die: the coordinator must be open here,
 * have a card version to run with, and its card must let this person's request run (a card on
 * trial runs for the founder only; the runner holds the same rule at the start of every run).
 */
async function intakeOf(client: Queryable, role: Role): Promise<RequestIntake> {
  const closed = (reason: RequestIntakeReason): RequestIntake => ({ open: false, reason });
  const row = await readIntake(client, COORDINATOR_AGENT_CODE);
  if (row?.company_kind !== 'company') return closed('private_space');
  if (row.switch !== 'enabled') return closed('coordinator_closed');
  if (!row.has_version || (row.card_status !== 'trial' && row.card_status !== 'active')) {
    return closed('coordinator_not_ready');
  }
  if (row.card_status === 'trial' && role !== 'founder') return closed('trial_founder_only');
  return { open: true, reason: null };
}

/**
 * Calls for the agent's run after a change request: the job of the agent of the active step, in
 * the requester's name. A stopped agent takes no new work, so nothing is put on the queue for it;
 * the trace run_not_started is written instead (ids only), and the request page reads from it that
 * the work stays with a person, also after the agent is opened again (opening an agent starts
 * nothing; the person routes the request again). No active step: nothing is called for.
 */
async function runAgain(
  client: Queryable,
  jobs: AgentRunSender,
  companyId: string,
  requestId: string,
): Promise<void> {
  const again = await agentToRunAgain(client, requestId);
  if (!again) {
    return;
  }
  if (!again.enabled) {
    await writeAudit(client, 'run_not_started', 'task', requestId);
    return;
  }
  await jobs.send(client, {
    companyId,
    userId: again.requesterUserId,
    taskId: requestId,
    agentCode: again.agentCode,
  });
}

function requestIdOf(request: FastifyRequest): string {
  const params = requestParams.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data.requestId;
}

function readerOf(context: CompanyContext): Reader {
  return { userId: context.session.userId, role: context.role };
}

async function detailOf(context: CompanyContext, row: RequestRow): Promise<RequestDetail> {
  const { client } = context;
  const reader = readerOf(context);
  const now = new Date();
  const [routings, runs, approvals, acceptances] = [
    await listRoutings(client, row.id),
    await listRuns(client, row.id),
    await listResultApprovals(client, row.id),
    await listAcceptances(client, row.id),
  ];
  const steps = await listSteps(
    client,
    runs.map((run) => run.id),
  );
  const journeyRows = { routings, runs, steps, approvals, acceptances };
  const names = await peopleNames(client, [...peopleOf(row), ...peopleOfJourney(journeyRows)]);
  const summary = toSummary(row, reader, names, now);
  const pending = approvals.find(
    (approval) => approval.status === 'pending' && approval.invalidated_at === null,
  );
  // The result on the page is the latest approved one.
  const approved = approvals.filter((approval) => approval.status === 'approved').at(-1);
  const waiting = acceptances.find(
    (acceptance) => acceptance.status === 'pending' && acceptance.invalidated_at === null,
  );
  const open = !isClosedTaskStatus(summary.status);
  const isRequester = row.requester_user_id === reader.userId;
  return requestDetailSchema.parse({
    ...summary,
    text: row.description ?? '',
    agent:
      row.step_agent_code !== null
        ? { code: row.step_agent_code, name: row.step_agent_name ?? row.step_agent_code }
        : null,
    approver:
      row.step_approver_user_id !== null
        ? { userId: row.step_approver_user_id, name: names.get(row.step_approver_user_id) ?? null }
        : null,
    closure: closureOf(row, names),
    journey: toJourney(journeyRows, names),
    approval: pending?.may_decide === true ? toApprovalCard(pending, names) : null,
    result: approved ? toResult(approved, names) : null,
    acceptance:
      waiting && isRequester
        ? { round: waiting.round, returnsToAgent: waiting.returns_to_agent }
        : null,
    actions: {
      // The same rules as office.close_request and office.correct_routing, which are the ones
      // that decide: the requester cancels; the founder and the approver of the active step stop
      // somebody else's request and correct the routing.
      cancel: open && isRequester,
      stop: open && !isRequester && row.reader_may_decide,
      reroute: open && row.reader_may_decide,
    },
    serverTime: now.toISOString(),
  });
}

export function registerRequestRoutes(
  app: FastifyInstance,
  { runner, config, jobs }: RouteDeps,
): void {
  app.get('/api/requests', async (request, reply): Promise<RequestList> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const query = listQuery.safeParse(request.query);
      if (!query.success) {
        throw invalidRequest();
      }
      const rows = await listRequests(context.client, {
        coordinator: COORDINATOR_AGENT_CODE,
        mine: query.data.mine === 'true',
        limit: REQUEST_LIST_LIMIT + 1,
      });
      const shown = rows.slice(0, REQUEST_LIST_LIMIT);
      const names = await peopleNames(context.client, shown.flatMap(peopleOf));
      const now = new Date();
      const reader = readerOf(context);
      return requestListSchema.parse({
        requests: shown.map((row) => toSummary(row, reader, names, now)),
        truncated: rows.length > REQUEST_LIST_LIMIT,
      });
    }),
  );

  app.get('/api/requests/intake', async (request, reply): Promise<RequestIntake> =>
    runner.withCompany(request, reply, INSIDERS, async (context) =>
      requestIntakeSchema.parse(await intakeOf(context.client, context.role)),
    ),
  );

  app.post('/api/requests', async (request, reply): Promise<RequestDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const body = createRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client, companyId, session } = context;
      // A send that is repeated answers the first record and starts nothing a second time.
      if (!(await ownRequestExists(client, body.data.id))) {
        const intake = await intakeOf(client, context.role);
        if (intake.reason === 'private_space') {
          throw privateSpace();
        }
        if (intake.reason !== null) {
          // Nothing is stored: the person keeps the text in the form and is told why.
          throw new ApiError(409, 'requests_not_open', INTAKE_MESSAGE[intake.reason]);
        }
        // Information only, but a day that has already ended is a slip of the hand: refused
        // before anything is stored. Today is accepted. A repeated send is not asked again.
        if (body.data.dueDate !== undefined && body.data.dueDate < officeDay(new Date())) {
          throw dueDatePast();
        }
        let opened = true;
        await client.query('savepoint open_request');
        try {
          await insertRequest(client, {
            id: body.data.id,
            title: deriveRequestTitle(body.data.text),
            text: body.data.text,
            dueDate: body.data.dueDate ?? null,
          });
        } catch (error) {
          await client.query('rollback to savepoint open_request');
          if (databaseErrorCode(error) !== '23505') {
            throw error;
          }
          // unique_violation: the id is taken. Either by this person's own send that was still in
          // flight when this one looked (a double click, a retry that overtook the first answer):
          // it has committed by now, so it is answered below like every repeated send and nothing
          // is started a second time. Or by a record this person did not open: refused.
          if (!(await ownRequestExists(client, body.data.id))) {
            throw invalidRequest();
          }
          opened = false;
        }
        if (opened) {
          // The coordinator's run, in the name of the requester; ids only (rule 10). The job is
          // stored with the request: both or neither.
          await jobs.send(client, {
            companyId,
            userId: session.userId,
            taskId: body.data.id,
            agentCode: COORDINATOR_AGENT_CODE,
          });
        }
      }
      const row = await readRequest(client, COORDINATOR_AGENT_CODE, body.data.id);
      if (!row) {
        throw notFound();
      }
      reply.code(201);
      return detailOf(context, row);
    }),
  );

  app.get('/api/requests/:requestId', async (request, reply): Promise<RequestDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const row = await readRequest(context.client, COORDINATOR_AGENT_CODE, requestIdOf(request));
      if (!row) {
        throw notFound();
      }
      return detailOf(context, row);
    }),
  );

  app.post('/api/requests/:requestId/close', async (request, reply): Promise<RequestDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const requestId = requestIdOf(request);
      const body = closeRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw invalidRequest();
      }
      // Hidden and missing are the same answer; the database's own check comes after.
      if (!(await readRequest(context.client, COORDINATOR_AGENT_CODE, requestId))) {
        throw notFound();
      }
      const reason = body.data.reason;
      await context.client.query('savepoint close_request');
      try {
        await closeRequest(
          context.client,
          requestId,
          reason !== undefined && reason.length > 0 ? reason : null,
        );
      } catch (error) {
        await context.client.query('rollback to savepoint close_request');
        const code = databaseErrorCode(error);
        if (code === '42501') throw actionNotAllowed();
        if (code === '23514') throw requestClosed();
        if (code === 'P0002') throw notFound();
        // invalid_parameter_value: a stop without the reason the requester must be able to read.
        if (code === '22023') throw reasonRequired();
        if (code === DEADLOCK) throw requestChanged();
        throw error;
      }
      const row = await readRequest(context.client, COORDINATOR_AGENT_CODE, requestId);
      if (!row) {
        throw notFound();
      }
      return detailOf(context, row);
    }),
  );

  app.get(
    '/api/requests/:requestId/routing-options',
    async (request, reply): Promise<RoutingOptions> =>
      runner.withCompany(request, reply, INSIDERS, async ({ client }) => {
        if (!(await readRequest(client, COORDINATOR_AGENT_CODE, requestIdOf(request)))) {
          throw notFound();
        }
        const units: RoutingOptions['units'] = [];
        for (const row of await listRoutingOptions(client, COORDINATOR_AGENT_CODE)) {
          let unit = units.at(-1);
          if (unit?.code !== row.unit_code) {
            unit = { code: row.unit_code, name: row.unit_name, agents: [] };
            units.push(unit);
          }
          if (row.agent_code !== null) {
            unit.agents.push({ code: row.agent_code, name: row.agent_name ?? row.agent_code });
          }
        }
        return routingOptionsSchema.parse({ units });
      }),
  );

  /**
   * "Yönlendirmeyi düzelt" (7 October decision 7): the founder or the approver of the active step
   * names the unit and an agent of it that is open here (a body without an agent is refused: a
   * person does not leave a request at a unit that has nobody to do it). The database decides who
   * may, closes what waited on the old step and appoints the approver of the new one; the agent's
   * run is put on the queue with the routing, both or neither. Routing to the agent that already
   * had the request starts its work again: this is also how a run that failed is tried again.
   */
  app.post('/api/requests/:requestId/routing', async (request, reply): Promise<RequestDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const requestId = requestIdOf(request);
      const body = correctRoutingSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client, companyId } = context;
      const before = await readRequest(client, COORDINATOR_AGENT_CODE, requestId);
      if (!before) {
        throw notFound();
      }
      if (before.status === 'done' || before.status === 'cancelled') {
        throw requestClosed();
      }
      const { unitCode, agentCode, note } = body.data;
      // The coordinator's own unit is never a place to route to (the list does not offer it).
      const options = await listRoutingOptions(client, COORDINATOR_AGENT_CODE);
      const offered = options.some(
        (row) => row.unit_code === unitCode && row.agent_code === agentCode,
      );
      if (!offered) {
        throw routingNotPossible();
      }
      await client.query('savepoint correct_routing');
      try {
        await correctRouting(client, requestId, {
          unitCode,
          agentCode,
          note: note !== undefined && note.length > 0 ? note : null,
        });
      } catch (error) {
        await client.query('rollback to savepoint correct_routing');
        const code = databaseErrorCode(error);
        if (code === '42501') throw actionNotAllowed();
        // check_violation: the agent was stopped or the request closed meanwhile.
        if (code === '23514') throw routingNotPossible();
        if (code === 'P0002') throw notFound();
        if (code === DEADLOCK) throw requestChanged();
        throw error;
      }
      // The run's identity stays the requester, whoever corrected the routing.
      await jobs.send(client, {
        companyId,
        userId: before.requester_user_id,
        taskId: requestId,
        agentCode,
      });
      const row = await readRequest(client, COORDINATOR_AGENT_CODE, requestId);
      if (!row) {
        throw notFound();
      }
      return detailOf(context, row);
    }),
  );

  app.post('/api/requests/:requestId/acceptance', async (request, reply): Promise<RequestDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const requestId = requestIdOf(request);
      const body = acceptanceDecisionSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client, companyId } = context;
      if (!(await readRequest(client, COORDINATOR_AGENT_CODE, requestId))) {
        throw notFound();
      }
      // The request first, as a close and a correction do: the answer then waits for them
      // instead of meeting them half way.
      await lockRequest(client, requestId);
      let decided: boolean;
      await client.query('savepoint decide_acceptance');
      try {
        decided = await decideAcceptance(
          client,
          requestId,
          body.data.decision === 'approved'
            ? { decision: 'approved' }
            : {
                decision: 'changes_requested',
                reason: body.data.reason ?? null,
                note: body.data.note,
              },
        );
      } catch (error) {
        await client.query('rollback to savepoint decide_acceptance');
        if (databaseErrorCode(error) === DEADLOCK) throw requestChanged();
        throw error;
      }
      if (!decided) {
        // Nothing of this request waits for this person: not the requester, already answered, or
        // closed by a stop or a new routing.
        throw approvalClosed();
      }
      if (body.data.decision === 'changes_requested') {
        // The same agent takes the requester's words; after the second time no step is active and
        // nothing starts by itself.
        await runAgain(client, jobs, companyId, requestId);
      }
      const row = await readRequest(client, COORDINATOR_AGENT_CODE, requestId);
      if (!row) {
        throw notFound();
      }
      return detailOf(context, row);
    }),
  );

  app.get('/api/approvals', async (request, reply): Promise<ApprovalDesk> =>
    runner.withCompany(request, reply, INSIDERS, async ({ client }) => {
      const approvals = await listPendingApprovals(client);
      const acceptances = await listPendingAcceptances(client);
      const results = await readResultApprovals(
        client,
        acceptances.map((acceptance) => acceptance.approval_id),
      );
      const names = await peopleNames(client, [
        ...approvals.map((approval) => approval.requester_user_id),
        ...results.flatMap((result) =>
          result.decided_by_user_id ? [result.decided_by_user_id] : [],
        ),
      ]);
      return approvalDeskSchema.parse({
        approvals: approvals.map((approval) => toApprovalCard(approval, names)),
        acceptances: acceptances.flatMap((acceptance) => {
          const result = results.find((row) => row.id === acceptance.approval_id);
          return result
            ? [
                {
                  requestId: acceptance.task_id,
                  requestTitle: acceptance.request_title,
                  round: acceptance.round,
                  returnsToAgent: acceptance.returns_to_agent,
                  openedAt: acceptance.created_at.toISOString(),
                  result: toResult(result, names),
                },
              ]
            : [];
        }),
      });
    }),
  );

  /**
   * One endpoint for the decision, whichever screen it is given on (5 October decision 10). The
   * database decides who may decide; an important approval is approved only after a passkey
   * re-verification for exactly this approval and this option.
   */
  app.post('/api/approvals/:approvalId/decision', async (request, reply): Promise<RequestDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const params = approvalParams.safeParse(request.params);
      if (!params.success) {
        throw notFound();
      }
      const body = approvalDecisionSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client, session, companyId } = context;
      const approval = await lockResultApproval(client, params.data.approvalId);
      if (!approval?.may_decide) {
        throw notFound();
      }
      if (approval.status !== 'pending' || approval.invalidated_at !== null) {
        throw approvalClosed();
      }
      const decision = body.data;
      if (decision.decision === 'approved') {
        const options = optionsOf(approval.payload);
        const chosen = decision.selectedOption;
        if (options.length > 0 && !options.some((option) => option.code === chosen)) {
          throw optionRequired();
        }
        if (approval.needs_step_up) {
          await verifyStepUp({ client, session }, config.relyingParty, decision.stepUp, {
            purpose: 'approve',
            companyId,
            subjectId: approval.id,
            details: approvalDecisionDetails(options.length > 0 ? chosen : undefined),
          });
        }
      }
      await client.query('savepoint decide_approval');
      try {
        await decideApproval(
          client,
          approval.id,
          decision.decision === 'approved'
            ? {
                decision: 'approved',
                selectedOption:
                  optionsOf(approval.payload).length > 0 ? (decision.selectedOption ?? null) : null,
              }
            : {
                decision: decision.decision,
                reason: decision.reason,
                note:
                  decision.note !== undefined && decision.note.length > 0 ? decision.note : null,
              },
        );
      } catch (error) {
        await client.query('rollback to savepoint decide_approval');
        const code = databaseErrorCode(error);
        // invalid_authorization_specification: no re-verification for this approval.
        if (code === '28000') throw stepUpRequired();
        // check_violation: the basis changed or the approval was closed meanwhile.
        if (code === '23514') throw approvalClosed();
        if (code === '42501') throw notFound();
        if (code === DEADLOCK) throw requestChanged();
        throw error;
      }
      if (decision.decision === 'changes_requested' && approval.attempt < 2) {
        // Back to the same agent with the approver's reason (2 October decision 10). After the
        // second change request the database refuses a third result and nothing is started.
        await runAgain(client, jobs, companyId, approval.task_id);
      }
      const row = await readRequest(client, COORDINATOR_AGENT_CODE, approval.task_id);
      if (!row) {
        throw notFound();
      }
      return detailOf(context, row);
    }),
  );
}
