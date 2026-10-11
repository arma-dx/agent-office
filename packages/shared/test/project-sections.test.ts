import { describe, expect, it } from 'vitest';
import {
  PROJECT_RUN_LIST_LIMIT,
  projectRunSchema,
  projectRunsSchema,
  runUsageSchema,
} from '../src/project-sections.ts';
import { usdSchema } from '../src/projects.ts';

// The sections of the project page that only read (8 October decision 17). What the contract
// keeps out is the point: no text of an agent (docs/SONRA.md V-c), and no cost for a reader who
// is not the founder (P-t).

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USAGE = {
  inputTokens: 900,
  outputTokens: 120,
  cacheWriteTokens: 30,
  cacheReadTokens: 4000,
  costUsd: '0.012345',
};

const RUN = {
  id: uuid(1),
  request: { id: uuid(2), title: 'Lansman gönderisi' },
  agent: { code: 'SOS-2', name: 'Sosyal Medya İçerik Ajanı' },
  status: 'completed',
  errorCode: null,
  startedAt: '2026-10-09T09:00:00.000Z',
  finishedAt: '2026-10-09T09:00:42.000Z',
  durationMs: 42_000,
  usage: USAGE,
};

describe('the runs of a project', () => {
  it('a project run carries no text field', () => {
    expect(Object.keys(projectRunSchema.shape)).toEqual([
      'id',
      'request',
      'agent',
      'status',
      'errorCode',
      'startedAt',
      'finishedAt',
      'durationMs',
      'usage',
    ]);
    // The request is its id and its title, the agent its code and its name: nothing else.
    expect(Object.keys(projectRunSchema.shape.request.unwrap().shape)).toEqual(['id', 'title']);
    expect(Object.keys(projectRunSchema.shape.agent.shape)).toEqual(['code', 'name']);
    // What a run row holds of an agent's words does not survive the parse.
    const parsed = projectRunSchema.parse({
      ...RUN,
      summary: 'Ajanın özeti',
      output: { final_text: 'Ajanın sözleri' },
      input: { tools: ['submit_for_approval'] },
      agentText: 'Ajanın sözleri',
      request: { ...RUN.request, description: 'Talebin metni' },
    });
    expect(parsed).toEqual(RUN);
    expect(JSON.stringify(parsed)).not.toContain('Ajanın');
    expect(JSON.stringify(parsed)).not.toContain('Talebin metni');

    // A run that is open, and one that is not on a request.
    const open = { ...RUN, status: 'running', finishedAt: null, durationMs: null, request: null };
    expect(projectRunSchema.parse(open)).toEqual(open);
    const stopped = { ...RUN, status: 'stopped', errorCode: 'agent_stopped' };
    expect(projectRunSchema.parse(stopped)).toEqual(stopped);
    for (const change of [
      { status: 'queued' },
      { agent: { code: 'sos-2', name: 'x' } },
      { request: { id: 'first', title: 'x' } },
      { startedAt: '2026-10-09' },
      { durationMs: -1 },
      { durationMs: 1.5 },
      { errorCode: undefined },
    ]) {
      expect(
        projectRunSchema.safeParse({ ...RUN, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });

  it('usage is all five numbers or null', () => {
    expect(runUsageSchema.parse(USAGE)).toEqual(USAGE);
    expect(projectRunSchema.parse({ ...RUN, usage: null }).usage).toBeNull();
    for (const field of Object.keys(USAGE)) {
      const without = Object.fromEntries(Object.entries(USAGE).filter(([name]) => name !== field));
      expect(runUsageSchema.safeParse(without).success, field).toBe(false);
      expect(projectRunSchema.safeParse({ ...RUN, usage: without }).success, field).toBe(false);
    }
    for (const change of [
      { inputTokens: -1 },
      { outputTokens: 1.5 },
      { cacheReadTokens: '4000' },
      // Cost is text, as the database holds it: never a number that was rounded on its way.
      { costUsd: 0.012345 },
      { costUsd: '0,012345' },
      { costUsd: '-1' },
      { costUsd: '1.2345678' },
      { costUsd: '' },
      { costUsd: null },
    ]) {
      expect(
        runUsageSchema.safeParse({ ...USAGE, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
    // The left side is left out of the usage, not zeroed: a reader who is not the founder gets
    // no number at all.
    expect(projectRunSchema.safeParse({ ...RUN, usage: undefined }).success).toBe(false);
    for (const amount of ['0', '0.000000', '1.67469', '12', '999999.999999']) {
      expect(usdSchema.parse(amount)).toBe(amount);
    }
  });

  it('the totals of the runs carry a count for everybody', () => {
    expect(PROJECT_RUN_LIST_LIMIT).toBe(200);
    const forFounder = {
      runs: [RUN],
      truncated: false,
      totals: { runCount: 6, usage: { ...USAGE, costUsd: '1.674690' } },
      serverTime: '2026-10-09T12:00:00.000Z',
    };
    expect(projectRunsSchema.parse(forFounder)).toEqual(forFounder);
    const forMember = {
      ...forFounder,
      runs: [{ ...RUN, usage: null }],
      totals: { runCount: 6, usage: null },
    };
    const parsed = projectRunsSchema.parse(forMember);
    expect(parsed).toEqual(forMember);
    expect(parsed.totals.runCount).toBe(6);
    expect(JSON.stringify(parsed)).not.toContain('costUsd');
    const empty = { ...forMember, runs: [], totals: { runCount: 0, usage: null } };
    expect(projectRunsSchema.parse(empty)).toEqual(empty);
    for (const change of [
      { totals: { usage: null } },
      { totals: { runCount: -1, usage: null } },
      { totals: { runCount: 6 } },
      { truncated: undefined },
      { serverTime: undefined },
      { runs: undefined },
    ]) {
      expect(
        projectRunsSchema.safeParse({ ...forMember, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });
});
