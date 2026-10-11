import { describe, expect, it } from 'vitest';
import {
  agentOpenResponseSchema,
  agentStopIfOpenResponseSchema,
  agentSwitchRequestSchema,
  companyAgentStatusSchema,
  officeResponseSchema,
  officeWorkCountSchema,
  waitingWorkQuerySchema,
  waitingWorkResponseSchema,
} from '../src/api.ts';
import {
  AGENT_FAILURE_CAUSES,
  OFFICE_AGENT_STATES,
  agentWorkOf,
  officeAgentState,
} from '../src/office.ts';
import {
  deriveStage,
  requestCauseSchema,
  requestStageSchema,
  type RequestFacts,
} from '../src/requests.ts';

// The live states of the office view (8 October decisions 9 and 10; docs/SONRA.md W-d): which
// desk an open request stands on, and which state a desk shows. Without a database.

const now = new Date('2026-10-09T12:00:00Z');
const ago = (ms: number): Date => new Date(now.getTime() - ms);
const base: RequestFacts = {
  status: 'open',
  createdAt: ago(10_000),
  closedBy: null,
  closedAfterDelivery: false,
  returnedNoAgent: false,
  coordinatorEnabled: true,
  agentsMayWork: true,
  requesterReads: true,
  routed: false,
  step: null,
  pendingApproval: false,
  pendingAcceptance: false,
  lastResult: null,
  changesRequested: false,
  awaitedSince: null,
  notStartedAt: null,
  lastRun: null,
};
const routed: RequestFacts = {
  ...base,
  status: 'in_progress',
  routed: true,
  step: { agentCode: 'SOS-2', agentEnabled: true },
  awaitedSince: ago(5_000),
};
const run = (
  agentCode: string,
  status: NonNullable<RequestFacts['lastRun']>['status'],
  errorCode: string | null = null,
): RequestFacts['lastRun'] => ({
  agentCode,
  status,
  errorCode,
  startedAt: ago(3_000),
  limitMinutes: null,
});
/** "AGENT kind" for the desk a request stands on, "-" for none. */
const desk = (facts: RequestFacts): string => {
  const work = agentWorkOf(facts, deriveStage(facts, now));
  return work === null ? '-' : `${work.agentCode} ${work.kind}`;
};

describe('the desk an open request stands on', () => {
  it('the coordinator runs while a request is being routed, also before its run has started', () => {
    expect(desk(base)).toBe('KOR-1 running');
    expect(desk({ ...base, lastRun: run('KOR-1', 'running') })).toBe('KOR-1 running');
    // Late, but still the coordinator's: the stage does not change by a guess.
    expect(desk({ ...base, createdAt: ago(60 * 60_000) })).toBe('KOR-1 running');
  });

  it('the agent of the active step runs while it works or revises, queued or started', () => {
    expect(desk(routed)).toBe('SOS-2 running');
    expect(desk({ ...routed, lastRun: run('SOS-2', 'running') })).toBe('SOS-2 running');
    expect(
      desk({
        ...routed,
        changesRequested: true,
        lastResult: { status: 'changes_requested', attempt: 1 },
        awaitedSince: ago(1_000),
      }),
    ).toBe('SOS-2 running');
    // The coordinator's finished run does not keep the request on its desk.
    expect(desk({ ...routed, lastRun: run('KOR-1', 'completed') })).toBe('SOS-2 running');
  });

  it('a result that waits for the unit approver stands on its agent’s desk as awaiting approval', () => {
    expect(
      desk({
        ...routed,
        status: 'awaiting_approval',
        pendingApproval: true,
        lastRun: run('SOS-2', 'completed'),
      }),
    ).toBe('SOS-2 awaiting_approval');
  });

  it('an approved result that waits for its requester stands on no desk', () => {
    expect(
      desk({
        ...routed,
        status: 'awaiting_approval',
        step: null,
        pendingAcceptance: true,
        lastRun: run('SOS-2', 'completed'),
      }),
    ).toBe('-');
  });

  it('a request that fell to a person because of the run is an error on the desk of that run’s agent', () => {
    // The three causes decision 10 names, for the unit's agent.
    expect(desk({ ...routed, lastRun: run('SOS-2', 'failed') })).toBe('SOS-2 failed');
    expect(desk({ ...routed, lastRun: run('SOS-2', 'failed', 'tool_error') })).toBe('SOS-2 failed');
    expect(desk({ ...routed, lastRun: run('SOS-2', 'limit_reached') })).toBe('SOS-2 failed');
    expect(desk({ ...routed, lastRun: run('SOS-2', 'completed') })).toBe('SOS-2 failed');
    // And for the coordinator, before any routing.
    expect(desk({ ...base, lastRun: run('KOR-1', 'failed') })).toBe('KOR-1 failed');
    expect(desk({ ...base, lastRun: run('KOR-1', 'limit_reached') })).toBe('KOR-1 failed');
  });

  it('every other way a request falls to a person leaves the desks as they are', () => {
    const others: [string, RequestFacts][] = [
      ['agent_stopped', { ...routed, lastRun: run('SOS-2', 'stopped', 'agent_stopped') }],
      ['agent_stopped', { ...routed, step: { agentCode: 'SOS-2', agentEnabled: false } }],
      ['run_interrupted', { ...routed, lastRun: run('SOS-2', 'stopped', 'request_changed') }],
      ['not_started', { ...routed, notStartedAt: ago(1_000) }],
      ['model_refused', { ...routed, lastRun: run('SOS-2', 'failed', 'model_refusal') }],
      ['model_unavailable', { ...routed, lastRun: run('SOS-2', 'failed', 'model_unavailable') }],
      ['model_billing', { ...routed, lastRun: run('SOS-2', 'failed', 'anthropic_billing') }],
      [
        'model_not_available',
        { ...routed, lastRun: run('SOS-2', 'failed', 'anthropic_model_not_found') },
      ],
      ['card_not_runnable', { ...routed, lastRun: run('SOS-2', 'failed', 'card_not_runnable') }],
      ['no_routing', { ...base, lastRun: run('KOR-1', 'completed') }],
      ['coordinator_closed', { ...base, coordinatorEnabled: false }],
      [
        'second_change_request',
        { ...routed, lastResult: { status: 'changes_requested', attempt: 2 } },
      ],
      // Held by a closed AI permission (rule 12), whatever its last run was: no desk, no error.
      ['ai_permission_closed', { ...routed, agentsMayWork: false }],
      [
        'ai_permission_closed',
        { ...routed, agentsMayWork: false, lastRun: run('SOS-2', 'failed') },
      ],
      ['ai_permission_closed', { ...base, agentsMayWork: false }],
      // The permission is open again and the run the close stopped was not started again.
      [
        'ai_permission_interrupted',
        { ...routed, lastRun: run('SOS-2', 'stopped', 'ai_permission_closed') },
      ],
      [
        'ai_permission_interrupted',
        { ...base, lastRun: run('KOR-1', 'stopped', 'ai_permission_closed') },
      ],
    ];
    for (const [cause, facts] of others) {
      const derived = deriveStage(facts, now);
      expect([derived.stage, derived.cause], cause).toEqual(['fell_to_person', cause]);
      expect(agentWorkOf(facts, derived), cause).toBeNull();
    }
  });

  it('names exactly three causes as the agent’s failure, and every cause is a known one', () => {
    expect(AGENT_FAILURE_CAUSES).toEqual(['run_failed', 'limit_reached', 'no_submission']);
    for (const cause of AGENT_FAILURE_CAUSES) {
      expect(requestCauseSchema.options).toContain(cause);
    }
  });

  it('a closed request stands on no desk, whatever its last run was', () => {
    for (const status of ['done', 'cancelled'] as const) {
      expect(desk({ ...routed, status, lastRun: run('SOS-2', 'failed') })).toBe('-');
    }
  });

  it('answers for every stage', () => {
    // A stage that is added later must be given a desk or none here, not fall through.
    expect(requestStageSchema.options).toHaveLength(8);
  });
});

describe('the state a desk shows', () => {
  const none = { running: 0, awaitingApproval: 0, failed: 0 };

  it('the switch comes first: closed and stopped do not depend on the work', () => {
    const busy = { running: 2, awaitingApproval: 1, failed: 1 };
    for (const counts of [none, busy]) {
      expect(officeAgentState(null, counts)).toBe('closed');
      expect(officeAgentState('disabled', counts)).toBe('closed');
      expect(officeAgentState('stopped', counts)).toBe('stopped');
    }
  });

  it('an open agent shows what needs a person most: error, then approval, then running, then idle', () => {
    expect(officeAgentState('enabled', none)).toBe('idle');
    expect(officeAgentState('enabled', { ...none, running: 3 })).toBe('running');
    expect(officeAgentState('enabled', { ...none, running: 3, awaitingApproval: 1 })).toBe(
      'awaiting_approval',
    );
    expect(officeAgentState('enabled', { running: 3, awaitingApproval: 2, failed: 1 })).toBe(
      'error',
    );
    expect(officeAgentState('enabled', { ...none, failed: 1 })).toBe('error');
    expect(officeAgentState('enabled', { ...none, awaitingApproval: 1 })).toBe('awaiting_approval');
  });

  it('has six states, and a state for every switch value', () => {
    expect(OFFICE_AGENT_STATES).toEqual([
      'closed',
      'idle',
      'running',
      'awaiting_approval',
      'error',
      'stopped',
    ]);
    for (const status of [null, ...companyAgentStatusSchema.options]) {
      expect(OFFICE_AGENT_STATES).toContain(officeAgentState(status, none));
    }
  });
});

describe('the office contract', () => {
  const REQUEST = '00000000-0000-4000-8000-000000000001';

  it('a count carries the request exactly when it counts one', () => {
    expect(officeWorkCountSchema.safeParse({ count: 0, requestId: null }).success).toBe(true);
    expect(officeWorkCountSchema.safeParse({ count: 1, requestId: REQUEST }).success).toBe(true);
    expect(officeWorkCountSchema.safeParse({ count: 2, requestId: null }).success).toBe(true);
    expect(officeWorkCountSchema.safeParse({ count: 1, requestId: null }).success).toBe(false);
    expect(officeWorkCountSchema.safeParse({ count: 2, requestId: REQUEST }).success).toBe(false);
    expect(officeWorkCountSchema.safeParse({ count: 0, requestId: REQUEST }).success).toBe(false);
    expect(officeWorkCountSchema.safeParse({ count: -1, requestId: null }).success).toBe(false);
  });

  it('the answer needs the units, the work and whether the work was cut', () => {
    expect(officeResponseSchema.safeParse({ units: [] }).success).toBe(false);
    expect(
      officeResponseSchema.safeParse({ units: [], work: [], workTruncated: false }).success,
    ).toBe(true);
  });

  it('a switch is opened, stopped, or stopped only where it is open; nothing else is sent', () => {
    const ok = (body: unknown) => agentSwitchRequestSchema.safeParse(body).success;
    expect(ok({ status: 'enabled' })).toBe(true);
    expect(ok({ status: 'stopped' })).toBe(true);
    expect(ok({ status: 'stopped', onlyIfOpen: true })).toBe(true);
    expect(ok({ status: 'stopped', onlyIfOpen: false })).toBe(true);
    // The condition belongs to a stop alone.
    expect(ok({ status: 'enabled', onlyIfOpen: true })).toBe(false);
    expect(ok({ status: 'disabled' })).toBe(false);
    expect(ok({ status: 'stopped', onlyIfOpen: 'yes' })).toBe(false);
    expect(ok({ status: 'stopped', everywhere: true })).toBe(false);
    expect(ok({})).toBe(false);
  });

  it('the answer of a stop "only if open" is the agent and whether this request stopped it', () => {
    const agent = { code: 'KOR-1', name: 'Ofis Koordinatörü', status: 'stopped', ready: true };
    expect(agentStopIfOpenResponseSchema.parse({ ...agent, changed: true })).toEqual({
      ...agent,
      changed: true,
    });
    expect(
      agentStopIfOpenResponseSchema.safeParse({ ...agent, status: null, changed: false }).success,
    ).toBe(true);
    // Without the word of the server the panel could not tell a stop from "already stopped".
    expect(agentStopIfOpenResponseSchema.safeParse(agent).success).toBe(false);
    expect(agentStopIfOpenResponseSchema.safeParse({ ...agent, changed: 'yes' }).success).toBe(
      false,
    );
  });

  // 8 October decision 49: opening an agent starts the work that waited for it.
  it('the answer of an opening is the agent and how many waiting requests it started again', () => {
    const agent = { code: 'HAF-2', name: 'Kurumsal Hafıza', status: 'enabled', ready: true };
    expect(agentOpenResponseSchema.parse({ ...agent, restarted: 3 })).toEqual({
      ...agent,
      restarted: 3,
    });
    expect(agentOpenResponseSchema.safeParse({ ...agent, restarted: 0 }).success).toBe(true);
    expect(agentOpenResponseSchema.safeParse(agent).success).toBe(false);
    for (const restarted of [-1, 0.5, '3', null]) {
      expect(
        agentOpenResponseSchema.safeParse({ ...agent, restarted }).success,
        String(restarted),
      ).toBe(false);
    }
  });

  it('the waiting work query takes exactly one scope', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(waitingWorkQuerySchema.parse({ agent: 'HAF-2' })).toEqual({ agent: 'HAF-2' });
    expect(waitingWorkQuerySchema.parse({ project: id })).toEqual({ project: id });
    expect(waitingWorkQuerySchema.parse({ customer: id })).toEqual({ customer: id });
    for (const query of [
      {},
      { agent: 'HAF-2', project: id },
      { project: id, customer: id },
      { agent: 'HAF-2', project: id, customer: id },
      // An unknown key, also next to a scope.
      { company: id },
      { agent: 'HAF-2', mine: 'true' },
      // A malformed id and a malformed agent code.
      { project: 'x' },
      { customer: '' },
      { agent: 'haf 2' },
      { agent: '' },
    ]) {
      expect(waitingWorkQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('the answer is a count that is not negative', () => {
    expect(waitingWorkResponseSchema.parse({ waiting: 0 })).toEqual({ waiting: 0 });
    expect(waitingWorkResponseSchema.parse({ waiting: 4 })).toEqual({ waiting: 4 });
    for (const answer of [
      {},
      { waiting: -1 },
      { waiting: 1.5 },
      { waiting: '4' },
      { waiting: null },
    ]) {
      expect(waitingWorkResponseSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(
        false,
      );
    }
    // Nothing else leaves with the number.
    expect(waitingWorkResponseSchema.safeParse({ waiting: 1, requests: [] }).success).toBe(false);
  });
});
