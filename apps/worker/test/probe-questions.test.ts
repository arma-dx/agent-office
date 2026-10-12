import { answerRequestQuestion, withContext } from '@agent-office/db';
import { parseCards, readCardFiles } from '@agent-office/db/cards';
import { parseDefinitions, readDefinitionFiles } from '@agent-office/db/definitions';
import { officeDay } from '@agent-office/shared';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PROBE_CASES,
  countByGroup,
  describeRun,
  observe,
  parseFlags,
  probeRequest,
  routedAsExpected,
  selectCases,
  unitsForProbe,
  type ProbeCase,
} from '../scripts/probe-questions-cases.ts';
import type { ModelRequest } from '../src/model/client.ts';
import { runAgentJob } from '../src/runner/run.ts';
import {
  RESULT,
  ROUTE_TO_SOS,
  admin,
  closeTestPools,
  ids,
  job,
  noDatabase,
  openRequest,
  runner,
  testPools,
} from './helpers.ts';
import { ScriptedModel, text, toolUse } from './scripted-model.ts';

// The probe of when agents ask is run by hand against the real models. What of it needs no
// model is held here: its cases, its flags, how it reads an answer, and above all that the
// request of a case is the request the runner sends for the same run. No model is called.

const AGENTS_DIR = new URL('../../../agents/', import.meta.url);
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);

const caseOf = (id: string): ProbeCase => {
  const found = PROBE_CASES.find((entry) => entry.id === id);
  if (!found) throw new Error(`No case ${id}`);
  return found;
};

describe('the probe of when agents ask: cases, flags and counts', () => {
  it('has the cases of the design, each with what a good run does', () => {
    const idsOf = (group: string) =>
      PROBE_CASES.filter((entry) => entry.group === group).map((entry) => entry.id);
    expect(idsOf('K')).toEqual(Array.from({ length: 12 }, (_, index) => `K${String(index + 1)}`));
    expect(idsOf('S')).toEqual(Array.from({ length: 11 }, (_, index) => `S${String(index + 1)}`));
    expect(idsOf('A')).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(idsOf('I')).toEqual(['I1', 'I2']);
    expect(new Set(PROBE_CASES.map((entry) => entry.id)).size).toBe(PROBE_CASES.length);
    // Fifteen cases of the coordinator and fourteen of the unit agent.
    expect(PROBE_CASES.filter((entry) => entry.agent === 'KOR-1')).toHaveLength(15);
    expect(PROBE_CASES.filter((entry) => entry.agent === 'SOS-2')).toHaveLength(14);
    // A question is expected in five cases and in no other.
    expect(PROBE_CASES.filter((entry) => entry.expects === 'ask').map((entry) => entry.id)).toEqual(
      ['K6', 'K7', 'S5', 'S6', 'S7'],
    );
    // Where the unit is clear the request must reach SOS-2: the failure of 8 October is a
    // request that was not routed, not a question.
    for (const id of ['K1', 'K2', 'K3', 'K4', 'K9', 'K10', 'K11', 'A3']) {
      expect(caseOf(id), id).toMatchObject({
        expects: 'no_ask',
        routes: [{ unit: 'SOS', agent: 'SOS-2' }],
      });
    }
    // A run after the agent's one question may not ask; the coordinator after its first may.
    expect(PROBE_CASES.filter((entry) => !entry.mayAsk).map((entry) => entry.id)).toEqual([
      'A1',
      'A2',
      'I1',
    ]);
    for (const entry of PROBE_CASES.filter((item) => item.group === 'A' || item.group === 'I')) {
      expect(entry.questions, entry.id).toHaveLength(1);
      expect(entry.questions?.[0], entry.id).toMatchObject({ askedBy: entry.agent, own: true });
    }
    // Invented data only: no address, no number that could be a person's.
    expect(JSON.stringify(PROBE_CASES)).not.toMatch(/@|\+90|\b0?5\d{9}\b/);
  });

  it('reads its flags, and refuses what it does not know', () => {
    expect(parseFlags([])).toEqual({ runs: 3, noAsk: false });
    expect(parseFlags(['--runs', '1', '--case', 'K3'])).toEqual({
      runs: 1,
      caseId: 'K3',
      noAsk: false,
    });
    expect(parseFlags(['--no-ask'])).toEqual({ runs: 3, noAsk: true });
    for (const bad of [['--runs', '0'], ['--runs', 'x'], ['--case', 'k3'], ['--sync'], ['K3']]) {
      expect(() => parseFlags(bad), bad.join(' ')).toThrow(/^Usage: /);
    }
    expect(selectCases({ noAsk: false })).toHaveLength(PROBE_CASES.length);
    expect(selectCases({ caseId: 'S6', noAsk: false }).map((entry) => entry.id)).toEqual(['S6']);
    // The baseline: group K alone, every case as a run that may not ask.
    const baseline = selectCases({ noAsk: true });
    expect(baseline.map((entry) => entry.id)).toEqual(
      PROBE_CASES.filter((entry) => entry.group === 'K').map((entry) => entry.id),
    );
    expect(baseline.every((entry) => !entry.mayAsk)).toBe(true);
    expect(selectCases({ caseId: 'S6', noAsk: true })).toEqual([]);
  });

  it('reads what a run did and counts it against what the case expects', () => {
    const routed = observe(toolUse('route_task', ROUTE_TO_SOS));
    const empty = observe(toolUse('route_task', { unit_code: '', agent_code: '', reason: 'x' }));
    const asked = observe(toolUse('ask_requester', { question: 'Nerede kullanılacak?' }));
    const submitted = observe(toolUse('submit_for_approval', { ...RESULT, goes_external: true }));
    const prose = observe(text('Bilgi eksik.'));
    expect(routed).toEqual({ tool: 'route_task', unit: 'SOS', agent: 'SOS-2' });
    expect(empty).toEqual({ tool: 'route_task', unit: null, agent: null });
    expect(asked).toEqual({ tool: 'ask_requester', question: 'Nerede kullanılacak?' });
    expect(submitted).toEqual({
      tool: 'submit_for_approval',
      title: RESULT.title,
      options: 2,
      goesExternal: true,
    });
    expect(prose).toEqual({ tool: null });
    expect(observe(toolUse('send_email', {}))).toEqual({ tool: 'other', name: 'send_email' });

    // Where the request went, against the case.
    expect(routedAsExpected(caseOf('K3'), routed)).toBe(true);
    expect(routedAsExpected(caseOf('K3'), empty)).toBe(false);
    expect(routedAsExpected(caseOf('K3'), asked)).toBeNull();
    expect(routedAsExpected(caseOf('K6'), routed)).toBeNull();
    expect(routedAsExpected(caseOf('K8'), empty)).toBe(true);
    expect(routedAsExpected(caseOf('K5'), routed)).toBe(false);
    const design = observe(toolUse('route_task', { unit_code: 'TAS', agent_code: 'TAS-3' }));
    expect(routedAsExpected(caseOf('K12'), design)).toBe(true);
    expect(describeRun(caseOf('K3'), routed)).toBe('route_task unit=SOS agent=SOS-2 expected=yes');
    expect(describeRun(caseOf('K3'), empty)).toBe('route_task unit="" agent="" expected=NO');
    expect(describeRun(caseOf('K7'), prose)).toBe('düz metin');
    expect(describeRun(caseOf('K6'), asked)).toBe(
      'ask_requester length=20 question="Nerede kullanılacak?"',
    );
    expect(describeRun(caseOf('S1'), submitted)).toContain('options=2 goes_external=true');

    // The counts of a round: who asked, who asked where it should not, and which request with
    // a clear unit did not reach its agent (an empty unit and a question both count).
    const counts = countByGroup([
      { entry: caseOf('K3'), seen: routed },
      { entry: caseOf('K3'), seen: empty },
      { entry: caseOf('K2'), seen: asked },
      { entry: caseOf('K6'), seen: asked },
      { entry: caseOf('K5'), seen: routed },
      { entry: caseOf('K7'), seen: prose },
      { entry: caseOf('S5'), seen: asked },
      { entry: caseOf('S11'), seen: asked },
      { entry: caseOf('S1'), seen: submitted },
    ]);
    expect(counts).toEqual([
      {
        group: 'K',
        runs: 6,
        asked: 2,
        prose: 1,
        askedWrongly: ['K2'],
        notRouted: ['K3', 'K2'],
        routedOtherwise: ['K5'],
      },
      // S11 is observed and not counted as a question that should not have been asked.
      {
        group: 'S',
        runs: 3,
        asked: 2,
        prose: 0,
        askedWrongly: [],
        notRouted: [],
        routedOtherwise: [],
      },
    ]);
  });
});

describe.skipIf(noDatabase)('the probe sends what the runner sends', () => {
  afterAll(closeTestPools);

  const noon = Date.parse('2026-10-12T09:00:00Z');
  const today = officeDay(noon);

  async function files() {
    const cards = parseCards(await readCardFiles(AGENTS_DIR, SKILLS_DIR));
    const units = unitsForProbe(
      parseDefinitions(await readDefinitionFiles(AGENTS_DIR)),
      cards.versions,
    );
    const stored = (code: string) => {
      const version = cards.versions.find((entry) => entry.card.code === code);
      if (!version) throw new Error(`No card ${code}`);
      return version;
    };
    return { units, stored };
  }

  /** The runner's request of one run, with a scripted model, for a request of the employee. */
  async function sentBy(
    taskId: string,
    agentCode: string,
    answer: Parameters<typeof toolUse>,
  ): Promise<ModelRequest | undefined> {
    const model = new ScriptedModel([toolUse(...answer)]);
    const { deps } = await runner(model, { now: () => noon });
    await runAgentJob(deps, job(taskId, agentCode, ids.employee));
    return model.requests[0];
  }

  const answers = async (taskId: string, answer: string): Promise<void> => {
    const [open] = await admin<{ id: string }>(
      `select id from office.task_questions where task_id = $1 and status = 'open'`,
      [taskId],
    );
    await withContext(testPools().app, { companyId: ids.arma, userId: ids.employee }, (client) =>
      answerRequestQuestion(client, open?.id ?? '', answer),
    );
  };

  it('a first run of the coordinator and of the unit agent: byte for byte the runner’s request', async () => {
    const { units, stored } = await files();
    const first = caseOf('K1');
    const taskId = await openRequest(ids.employee, first.text);
    // The instructions, the tools with the asking tool as each agent is given it, the forced
    // choice among two tools, the model and its profile, and the data blocks with the units
    // of the company.
    expect(probeRequest(stored('KOR-1'), units, first, today)).toEqual(
      await sentBy(taskId, 'KOR-1', ['route_task', ROUTE_TO_SOS]),
    );
    const writing = { ...caseOf('S1'), text: first.text };
    const sent = await sentBy(taskId, 'SOS-2', ['submit_for_approval', RESULT]);
    expect(probeRequest(stored('SOS-2'), units, writing, today)).toEqual(sent);
    expect(sent?.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toEqual([
      'submit_for_approval',
      'ask_requester',
    ]);
  });

  it('a run after an answer, and the baseline that may not ask', async () => {
    const { units, stored } = await files();
    // A1: the unit agent asked about the event and was answered; it may not ask again.
    const after = caseOf('A1');
    const [asked] = after.questions ?? [];
    const taskId = await openRequest(ids.employee, after.text);
    await sentBy(taskId, 'KOR-1', ['route_task', ROUTE_TO_SOS]);
    await sentBy(taskId, 'SOS-2', ['ask_requester', { question: asked?.question }]);
    await answers(taskId, asked?.answer ?? '');
    const sent = await sentBy(taskId, 'SOS-2', ['submit_for_approval', RESULT]);
    expect(probeRequest(stored('SOS-2'), units, after, today)).toEqual(sent);
    expect(JSON.stringify(sent?.messages)).toContain('questions_and_answers');

    // A3: the coordinator asked once and was answered; one question is left.
    const routing = caseOf('A3');
    const [where] = routing.questions ?? [];
    const unclear = await openRequest(ids.employee, routing.text);
    await sentBy(unclear, 'KOR-1', ['ask_requester', { question: where?.question }]);
    await answers(unclear, where?.answer ?? '');
    const second = await sentBy(unclear, 'KOR-1', ['ask_requester', { question: 'Hangi ürün?' }]);
    expect(probeRequest(stored('KOR-1'), units, routing, today)).toEqual(second);

    // The baseline of group K is the request of a coordinator that may not ask: after its
    // second question the runner sends these instructions, this one tool and this choice.
    await answers(unclear, 'Bilmiyorum.');
    const third = await sentBy(unclear, 'KOR-1', ['route_task', ROUTE_TO_SOS]);
    const [baseline] = selectCases({ caseId: 'K6', noAsk: true });
    if (!baseline) throw new Error('No baseline case');
    const probe = probeRequest(stored('KOR-1'), units, baseline, today);
    expect(probe.system).toEqual(third?.system);
    expect(probe.tools).toEqual(third?.tools);
    expect(probe.tool_choice).toEqual(third?.tool_choice);
    expect(probe.tool_choice).toEqual({
      type: 'tool',
      name: 'route_task',
      disable_parallel_tool_use: true,
    });
    expect(JSON.stringify(probe.messages)).not.toContain('questions_and_answers');
  });
});
