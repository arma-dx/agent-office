import type { RequestRow } from '@agent-office/db';
import { officeAgentWorkSchema } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { officeLive, officeWork, workOfRequest } from '../src/office-view.ts';

// The live part of the office answer (8 October decision 10), without a database: which desk a
// request row stands on, and how the rows of a company are counted per agent.

const NOW = new Date('2026-10-09T09:00:00.000Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A request row as the statement gives it; a request that was only just opened unless changed. */
function row(n: number, overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: id(n),
    title: 'LinkedIn için gönderi yaz',
    description: 'LinkedIn için gönderi yaz',
    status: 'open',
    created_at: ago(10_000),
    updated_at: ago(10_000),
    due_date: null,
    requester_user_id: id(900),
    closed_by_user_id: null,
    close_reason: null,
    closed_after_delivery: false,
    returned_no_agent: false,
    rejected_by_user_id: null,
    rejected_reason: null,
    rejected_note: null,
    reader_may_decide: false,
    unit_code: null,
    unit_name: null,
    coordinator_name: 'Ofis Koordinatörü',
    coordinator_enabled: true,
    reader_can_approve: false,
    routed: false,
    step_agent_code: null,
    step_agent_name: null,
    step_agent_enabled: null,
    step_approver_user_id: null,
    step_created_at: null,
    pending_acceptance: false,
    pending_result: false,
    last_result_status: null,
    last_result_attempt: null,
    last_change_request_at: null,
    not_started_at: null,
    run_agent_code: null,
    run_status: null,
    run_error_code: null,
    run_started_at: null,
    run_limit_minutes: null,
    ...overrides,
  };
}

const routed = (agent: string): Partial<RequestRow> => ({
  status: 'in_progress',
  routed: true,
  unit_code: 'SOS',
  unit_name: 'Sosyal Medya',
  step_agent_code: agent,
  step_agent_name: agent,
  step_agent_enabled: true,
  step_created_at: ago(5_000),
});
const ran = (
  agent: string,
  status: string,
  errorCode: string | null = null,
): Partial<RequestRow> => ({
  run_agent_code: agent,
  run_status: status,
  run_error_code: errorCode,
  run_started_at: ago(3_000),
});

describe('the desk a request row stands on', () => {
  it('reads the stage from the same facts as the request page', () => {
    expect(workOfRequest(row(1), NOW)).toEqual({
      agentCode: 'KOR-1',
      kind: 'running',
      requestId: id(1),
    });
    expect(workOfRequest(row(2, routed('SOS-2')), NOW)).toEqual({
      agentCode: 'SOS-2',
      kind: 'running',
      requestId: id(2),
    });
    expect(
      workOfRequest(
        row(3, { ...routed('SOS-2'), status: 'awaiting_approval', pending_result: true }),
        NOW,
      ),
    ).toMatchObject({ agentCode: 'SOS-2', kind: 'awaiting_approval' });
    expect(
      workOfRequest(row(4, { ...routed('SOS-2'), ...ran('SOS-2', 'failed', 'tool_error') }), NOW),
    ).toMatchObject({ agentCode: 'SOS-2', kind: 'failed' });
    // Waiting for its requester, fallen for another reason, closed: no desk.
    expect(
      workOfRequest(
        row(5, { status: 'awaiting_approval', routed: true, pending_acceptance: true }),
        NOW,
      ),
    ).toBeNull();
    expect(
      workOfRequest(
        row(6, { ...routed('SOS-2'), ...ran('SOS-2', 'stopped', 'agent_stopped') }),
        NOW,
      ),
    ).toBeNull();
    expect(workOfRequest(row(7, { ...routed('SOS-2'), status: 'cancelled' }), NOW)).toBeNull();
  });
});

describe('the counts of the office answer', () => {
  const NONE = { count: 0, requestId: null };

  it('counts per agent and condition, and names the request only when it is the one', () => {
    const rows = [
      row(1),
      row(2),
      row(3, routed('SOS-2')),
      row(4, { ...routed('SOS-2'), status: 'awaiting_approval', pending_result: true }),
      row(5, { ...routed('SOS-2'), status: 'awaiting_approval', pending_result: true }),
      row(6, { ...routed('SOS-2'), ...ran('SOS-2', 'limit_reached') }),
      row(7, { ...routed('TAS-3'), ...ran('TAS-3', 'completed') }),
      // No desk: the approved result waits for its requester.
      row(8, { status: 'awaiting_approval', routed: true, pending_acceptance: true }),
    ];
    const work = officeWork(rows, ['KOR-1', 'KOR-2', 'SOS-2', 'TAS-3'], NOW);
    expect(work).toEqual([
      {
        agentCode: 'KOR-1',
        running: { count: 2, requestId: null },
        awaitingApproval: NONE,
        failed: NONE,
      },
      {
        agentCode: 'SOS-2',
        running: { count: 1, requestId: id(3) },
        awaitingApproval: { count: 2, requestId: null },
        failed: { count: 1, requestId: id(6) },
      },
      {
        agentCode: 'TAS-3',
        running: NONE,
        awaitingApproval: NONE,
        failed: { count: 1, requestId: id(7) },
      },
    ]);
    for (const entry of work) {
      expect(officeAgentWorkSchema.safeParse(entry).success).toBe(true);
    }
  });

  it('lists agents in the order of the office and leaves out an agent without work', () => {
    const rows = [row(1, routed('SOS-2')), row(2)];
    expect(
      officeWork(rows, ['SOS-2', 'HAF-1', 'KOR-1'], NOW).map((entry) => entry.agentCode),
    ).toEqual(['SOS-2', 'KOR-1']);
    expect(officeWork([], ['KOR-1'], NOW)).toEqual([]);
  });

  it('leaves out the work of an agent that has no desk in this office', () => {
    // A card that no longer names the company: its open request has nowhere to be shown.
    expect(officeWork([row(1, routed('ESK-1'))], ['KOR-1', 'SOS-2'], NOW)).toEqual([]);
  });

  it('carries ids and numbers only: no title, no text, no name', () => {
    const work = officeWork(
      [row(1, { title: 'GİZLİ BAŞLIK', description: 'GİZLİ METİN' })],
      ['KOR-1'],
      NOW,
    );
    expect(JSON.stringify(work)).not.toMatch(/GİZLİ|Koordinatör/);
  });

  it('counts at most the limit, the first rows of the pick, and says when a row was left out', () => {
    // Three rows for a limit of two: the third, the one that moved last, is not counted.
    const rows = [row(1), row(2), row(3, { ...routed('SOS-2') })];
    expect(officeLive(rows, ['KOR-1', 'SOS-2'], NOW, 2)).toEqual({
      work: [
        {
          agentCode: 'KOR-1',
          running: { count: 2, requestId: null },
          awaitingApproval: { count: 0, requestId: null },
          failed: { count: 0, requestId: null },
        },
      ],
      workTruncated: true,
    });
    // Exactly the limit: every row is counted and nothing was left out.
    const whole = officeLive(rows, ['KOR-1', 'SOS-2'], NOW, 3);
    expect(whole.workTruncated).toBe(false);
    expect(whole.work.map((entry) => entry.agentCode)).toEqual(['KOR-1', 'SOS-2']);
    // The limit of the contract when none is given.
    expect(officeLive(rows, ['KOR-1', 'SOS-2'], NOW)).toEqual(whole);
    expect(officeLive([], ['KOR-1'], NOW)).toEqual({ work: [], workTruncated: false });
  });
});
