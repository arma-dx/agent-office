import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids, TOOL } from './fixtures.ts';
import { closePools, inAdminTransaction, inTransaction, noDatabase, type Tx } from './helpers.ts';

// Business rules the database enforces itself: approval, note, run, task, audit log.
// The rules come from CLAUDE.md rules 4, 5, 9 and the 2 October decisions 7-13.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const korA: ContextInput = { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' };

async function openApproval(tx: Tx, fields: Record<string, unknown> = {}): Promise<string> {
  const all: Record<string, unknown> = {
    company_id: ids.arma,
    run_id: ids.runA,
    agent_code: 'KOR-1',
    title: 'Test',
    payload: {},
    ...fields,
  };
  const names = Object.keys(all);
  const [row] = await tx.rows<{ id: string }>(
    `insert into office.approvals (${names.join(', ')})
     values (${names.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
    Object.values(all),
  );
  if (!row) {
    throw new Error('Approval could not be opened');
  }
  return row.id;
}

describe.skipIf(noDatabase)('approval rules', () => {
  afterAll(closePools);

  it('only an agent opens an approval; a person cannot', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(
            `insert into office.approvals (company_id, run_id, agent_code, title, payload) values ($1, $2, 'KOR-1', 'x', '{}')`,
            [ids.arma, ids.runA],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it('an agent cannot decide; an employee who cannot approve cannot decide; an approver decides', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            ids.approvalA,
          ])
        ).code,
      ).toBe('42501');
      await tx.setContext(employeeA);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            ids.approvalA,
          ])
        ).code,
      ).toBe('42501');
      await tx.setContext(approverA);
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
          ids.approvalA,
        ]),
      ).toBe(1);
      const [approval] = await tx.rows(
        'select decided_by_user_id, decided_at is not null as decided from office.approvals where id = $1',
        [ids.approvalA],
      );
      expect(approval).toEqual({ decided_by_user_id: ids.approverA, decided: true });
    });
  });

  it('a rejection or change request needs a reason from the fixed list; a decided approval does not change', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'rejected' where id = $1`, [
            ids.approvalA,
          ])
        ).code,
      ).toBe('23514');
      expect(
        (
          await tx.expectError(
            `update office.approvals set status = 'rejected', rejection_reason = 'disliked' where id = $1`,
            [ids.approvalA],
          )
        ).code,
      ).toBe('23514');
      await tx.exec(
        `update office.approvals set status = 'rejected', rejection_reason = 'pricing', decision_reason = 'Price too high' where id = $1`,
        [ids.approvalA],
      );
      expect(
        (
          await tx.expectError(
            `update office.approvals set status = 'approved', rejection_reason = null where id = $1`,
            [ids.approvalA],
          )
        ).code,
      ).toBe('23514');
      expect(
        (
          await tx.expectError(
            `update office.approvals set decision_reason = 'other' where id = $1`,
            [ids.approvalA],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('the approval content cannot change after opening and an approval cannot be invalidated manually', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(`update office.approvals set payload = '{"x":1}' where id = $1`, [
            ids.approvalA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(`update office.approvals set invalidated_at = now() where id = $1`, [
            ids.approvalA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (await tx.expectError(`delete from office.approvals where id = $1`, [ids.approvalA])).code,
      ).toBe('42501');
    });
  });

  it('a single pending approval exists for the same record', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const result = await tx.expectError(
        `insert into office.approvals (company_id, run_id, agent_code, title, payload, basis_type, basis_id, basis_version)
         values ($1, $2, 'KOR-1', 'Second', '{}', 'note', $3, 1)`,
        [ids.arma, ids.runA, ids.noteA],
      );
      expect(result.code).toBe('23505');
    });
  });

  it('when its basis record changes a pending approval closes and cannot be approved; a new approval opens for the new version', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(`update office.notes set body = 'Yeni içerik' where id = $1`, [ids.noteA]);
      const [approval] = await tx.rows<{ closed: boolean }>(
        'select invalidated_at is not null as closed from office.approvals where id = $1',
        [ids.approvalA],
      );
      expect(approval?.closed).toBe(true);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            ids.approvalA,
          ])
        ).message,
      ).toMatch(/based on changed/);

      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(
            `insert into office.approvals (company_id, run_id, agent_code, title, payload, basis_type, basis_id, basis_version) values ($1, $2, 'KOR-1', 'x', '{}', 'note', $3, 1)`,
            [ids.arma, ids.runA, ids.noteA],
          )
        ).message,
      ).toMatch(/not current/);
      await openApproval(tx, { basis_type: 'note', basis_id: ids.noteA, basis_version: 2 });
    });
  });

  it("a task's status change does not close the approval, a content change does", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const id = await openApproval(tx, {
        task_id: ids.taskA,
        basis_type: 'task',
        basis_id: ids.taskA,
        basis_version: 1,
      });
      await tx.setContext(founderA);
      await tx.exec(`update office.tasks set status = 'awaiting_approval' where id = $1`, [
        ids.taskA,
      ]);
      expect(await tx.count('approvals', 'id = $1 and invalidated_at is null', [id])).toBe(1);
      await tx.exec(`update office.tasks set due_at = now() where id = $1`, [ids.taskA]);
      expect(await tx.count('approvals', 'id = $1 and invalidated_at is not null', [id])).toBe(1);
    });
  });

  it('work with changes requested returns to the same agent; after the second change request it falls to a person', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const first = await openApproval(tx, { task_id: ids.taskA });
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvals set status = 'changes_requested', rejection_reason = 'incomplete' where id = $1`,
        [first],
      );

      await tx.setContext(korA);
      const second = await openApproval(tx, { task_id: ids.taskA, previous_approval_id: first });
      expect(await tx.rows('select attempt from office.approvals where id = $1', [second])).toEqual(
        [{ attempt: 2 }],
      );
      // A pending approval cannot be the "previous" one.
      expect(
        (
          await tx.expectError(
            `insert into office.approvals (company_id, run_id, agent_code, title, payload, task_id, previous_approval_id) values ($1, $2, 'KOR-1', 'x', '{}', $3, $4)`,
            [ids.arma, ids.runA, ids.taskA, second],
          )
        ).code,
      ).toBe('23514');

      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvals set status = 'changes_requested', rejection_reason = 'language_and_tone' where id = $1`,
        [second],
      );
      await tx.setContext(korA);
      const third = await tx.expectError(
        `insert into office.approvals (company_id, run_id, agent_code, title, payload, task_id, previous_approval_id) values ($1, $2, 'KOR-1', 'x', '{}', $3, $4)`,
        [ids.arma, ids.runA, ids.taskA, second],
      );
      expect(third.message).toMatch(/falls to a person/);
    });
  });

  it('an approval with options needs a valid option selected', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const id = await openApproval(tx, {
        options: JSON.stringify([{ code: 'a' }, { code: 'b' }]),
      });
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            id,
          ])
        ).code,
      ).toBe('23514');
      expect(
        (
          await tx.expectError(
            `update office.approvals set status = 'approved', selected_option = 'c' where id = $1`,
            [id],
          )
        ).code,
      ).toBe('23514');
      expect(
        await tx.exec(
          `update office.approvals set status = 'approved', selected_option = 'b' where id = $1`,
          [id],
        ),
      ).toBe(1);
    });
  });

  it('a person sets the sent mark only on approved work, and only once', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(
        (
          await tx.expectError(`update office.approvals set sent_at = now() where id = $1`, [
            ids.approvalA,
          ])
        ).code,
      ).toBe('23514');
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(`update office.approvals set sent_at = now() where id = $1`, [
            ids.approvalAApproved,
          ])
        ).code,
      ).toBe('42501');
      await tx.setContext(employeeA);
      expect(
        await tx.exec(`update office.approvals set sent_at = now() where id = $1`, [
          ids.approvalAApproved,
        ]),
      ).toBe(1);
      expect(
        await tx.rows('select sent_by_user_id from office.approvals where id = $1', [
          ids.approvalAApproved,
        ]),
      ).toEqual([{ sent_by_user_id: ids.employeeA }]);
      expect(
        (
          await tx.expectError(
            `update office.approvals set sent_at = now() + interval '1 hour' where id = $1`,
            [ids.approvalAApproved],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('an external effect tool call cannot be opened without an approved approval; an approval is used once', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const open = (seq: number, approval: string | null, status = 'started') =>
        tx.expectError(
          `insert into office.tool_calls (company_id, run_id, seq, tool_name, status, approval_id) values ($1, $2, $3, $4, $5, $6)`,
          [ids.arma, ids.runA, seq, TOOL.externalEffect, status, approval],
        );
      expect((await open(10, null)).code).toBe('42501');
      expect((await open(11, ids.approvalA)).code).toBe('42501');
      expect((await open(12, null, 'succeeded')).code).toBe('42501');
      // A call record sent for approval is opened without approval.
      await tx.exec(
        `insert into office.tool_calls (company_id, run_id, seq, tool_name, status, approval_id) values ($1, $2, 13, $3, 'sent_for_approval', $4)`,
        [ids.arma, ids.runA, TOOL.externalEffect, ids.approvalAApproved],
      );
      expect(
        await tx.exec(
          `update office.tool_calls set status = 'started' where run_id = $1 and seq = 13`,
          [ids.runA],
        ),
      ).toBe(1);
      expect((await open(14, ids.approvalAApproved)).code).toBe('23505');
    });
  });

  it("an approval cannot be used in another agent's call; a finished call cannot be restarted", async () => {
    await inTransaction(async (tx) => {
      // Enable HAF-1 and try to use KOR-1's approval in its own run.
      await tx.setContext(founderA);
      await tx.exec(
        `update office.company_agents set status = 'enabled' where company_id = $1 and agent_code = 'HAF-1'`,
        [ids.arma],
      );
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'HAF-1' });
      const [run] = await tx.rows<{ id: string }>(
        `insert into office.runs (company_id, agent_code, card_version_id, trigger_type, model) values ($1, 'HAF-1', $2, 'request', 'test-model') returning id`,
        [ids.arma, ids.cardHaf],
      );
      expect(
        (
          await tx.expectError(
            `insert into office.tool_calls (company_id, run_id, seq, tool_name, status, approval_id) values ($1, $2, 1, $3, 'started', $4)`,
            [ids.arma, run?.id, TOOL.externalEffect, ids.approvalAApproved],
          )
        ).code,
      ).toBe('42501');

      // KOR-1 uses the approval once; after a failure the same record cannot be restarted.
      await tx.setContext(korA);
      await tx.exec(
        `insert into office.tool_calls (company_id, run_id, seq, tool_name, status, approval_id) values ($1, $2, 20, $3, 'started', $4)`,
        [ids.arma, ids.runA, TOOL.externalEffect, ids.approvalAApproved],
      );
      await tx.exec(
        `update office.tool_calls set status = 'failed' where run_id = $1 and seq = 20`,
        [ids.runA],
      );
      expect(
        (
          await tx.expectError(
            `update office.tool_calls set status = 'started' where run_id = $1 and seq = 20`,
            [ids.runA],
          )
        ).code,
      ).toBe('23514');
      expect(
        (
          await tx.expectError(
            `update office.tool_calls set status = 'started' where run_id = $1 and seq = 1`,
            [ids.runA],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('work whose basis changed after approval cannot be executed', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const id = await openApproval(tx, {
        tool_name: TOOL.externalEffect,
        basis_type: 'task',
        basis_id: ids.taskA,
        basis_version: 1,
      });
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [id]);
      await tx.exec(`update office.tasks set description = 'Changed' where id = $1`, [ids.taskA]);
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(
            `insert into office.tool_calls (company_id, run_id, seq, tool_name, status, approval_id) values ($1, $2, 30, $3, 'started', $4)`,
            [ids.arma, ids.runA, TOOL.externalEffect, id],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it('only the founder flags a critical error, on approved work, with a reason', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const id = await openApproval(tx);
      await tx.setContext(founderA);
      const flag = (approval: string) =>
        tx.expectError(
          `insert into office.critical_errors (company_id, approval_id, agent_code, reason, flagged_by_user_id) values ($1, $2, 'KOR-1', 'Wrong', $3)`,
          [ids.arma, approval, ids.founder],
        );
      expect((await flag(id)).code).toBe('23514');
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [id]);
      await tx.setContext(approverA);
      expect((await flag(id)).code).toBe('42501');
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.critical_errors (company_id, approval_id, agent_code, reason, flagged_by_user_id) values ($1, $2, 'HAF-1', 'Wrong', $3)`,
        [ids.arma, id, ids.employeeA],
      );
      // The agent and the flagging person come from the record and the context.
      expect(
        await tx.rows(
          'select agent_code, flagged_by_user_id from office.critical_errors where approval_id = $1',
          [id],
        ),
      ).toEqual([{ agent_code: 'KOR-1', flagged_by_user_id: ids.founder }]);
    });
  });
});

describe.skipIf(noDatabase)('note rules', () => {
  afterAll(closePools);

  it("until approval an agent's draft note is seen only by approvers and the writing agent", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      const [draft] = await tx.rows<{ id: string; status: string }>(
        `insert into office.notes (company_id, title, body) values ($1, 'Ajan Taslağı', 'Özet [[Genel Not]]') returning id, status`,
        [ids.arma],
      );
      expect(draft?.status).toBe('draft');
      const id = draft?.id;
      await tx.exec(
        `insert into office.documents (company_id, drive_file_id, name, source_note_id) values ($1, 'drive_draft_document', 'Draft source', $2)`,
        [ids.arma, id],
      );
      // The draft's approval record carries the draft's text.
      const approval = await openApproval(tx, {
        title: 'Draft note',
        payload: { body: 'Özet' },
        basis_type: 'note',
        basis_id: id,
        basis_version: 1,
      });
      const visible = async () => ({
        note: await tx.count('notes', 'id = $1', [id]),
        version: await tx.count('note_versions', 'note_id = $1', [id]),
        link: await tx.count('note_links', 'source_note_id = $1', [id]),
        document: await tx.count('documents', 'source_note_id = $1', [id]),
        approval: await tx.count('approvals', 'id = $1', [approval]),
      });
      const all = { note: 1, version: 1, link: 1, document: 1, approval: 1 };
      const none = { note: 0, version: 0, link: 0, document: 0, approval: 0 };
      expect(await visible()).toEqual(all);

      // The agent cannot share the draft itself.
      expect(
        (await tx.expectError(`update office.notes set status = 'active' where id = $1`, [id]))
          .code,
      ).toBe('42501');

      // An employee who cannot approve and another agent can neither see nor change it.
      await tx.setContext(employeeA);
      expect(await visible()).toEqual(none);
      expect(await tx.exec(`update office.notes set body = 'x' where id = $1`, [id])).toBe(0);
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'HAF-1' });
      expect(await visible()).toEqual(none);

      // Even if shared with an external person, they cannot see it until approval.
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.access_grants (company_id, user_id, record_type, record_id) values ($1, $2, 'note', $3)`,
        [ids.arma, ids.externalA, id],
      );
      await tx.setContext({ companyId: ids.arma, userId: ids.externalA });
      expect(await tx.count('notes', 'id = $1', [id])).toBe(0);

      // KOR-3 summarises the approval queue: it sees the approval record, not the draft note
      // itself; if the person it runs for cannot approve, it does not see the approval either
      // (3 October, decision 3).
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-3' });
      expect(await visible()).toEqual({ ...none, approval: 1 });
      await tx.setContext({ companyId: ids.arma, userId: ids.employeeA, agentCode: 'KOR-3' });
      expect(await visible()).toEqual(none);

      // Approvers see it.
      await tx.setContext(approverA);
      expect(await visible()).toEqual(all);
      await tx.setContext(founderA);
      expect(await visible()).toEqual(all);

      // Once approved and active, everyone in the company sees it.
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]);
      await tx.exec(`update office.notes set status = 'active' where id = $1`, [id]);
      await tx.setContext(employeeA);
      expect(await tx.count('notes', 'id = $1', [id])).toBe(1);
      expect(await tx.count('approvals', 'id = $1', [approval])).toBe(1);
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'HAF-1' });
      expect(await tx.count('notes', 'id = $1', [id])).toBe(1);
      await tx.setContext({ companyId: ids.arma, userId: ids.externalA });
      expect(await tx.count('notes', 'id = $1', [id])).toBe(1);
    });
  });

  it('an agent run sees drafts within the limits of the person it runs for', async () => {
    await inTransaction(async (tx) => {
      // A draft written on behalf of the founder.
      await tx.setContext(korA);
      const [founderDraft] = await tx.rows<{ id: string }>(
        `insert into office.notes (company_id, title) values ($1, 'Kurucu adına taslak') returning id`,
        [ids.arma],
      );
      // A run on behalf of an employee who cannot approve opens and sees its own draft, but not
      // the draft written on behalf of the founder.
      const forEmployee = { companyId: ids.arma, userId: ids.employeeA, agentCode: 'KOR-1' };
      await tx.setContext(forEmployee);
      const [employeeDraft] = await tx.rows<{ id: string; created_by_user_id: string }>(
        `insert into office.notes (company_id, title) values ($1, 'Çalışan adına taslak') returning id, created_by_user_id`,
        [ids.arma],
      );
      expect(employeeDraft?.created_by_user_id).toBe(ids.employeeA);
      expect(await tx.count('notes', 'id = $1', [employeeDraft?.id])).toBe(1);
      expect(await tx.count('notes', 'id = $1', [founderDraft?.id])).toBe(0);
      // A run on behalf of an approver sees both; the employee sees neither in the panel.
      await tx.setContext({ companyId: ids.arma, userId: ids.approverA, agentCode: 'KOR-1' });
      expect(await tx.count('notes', 'id = any($1)', [[founderDraft?.id, employeeDraft?.id]])).toBe(
        2,
      );
      await tx.setContext(employeeA);
      expect(await tx.count('notes', 'id = any($1)', [[founderDraft?.id, employeeDraft?.id]])).toBe(
        0,
      );
    });
  });

  it("a person's draft note stays visible inside the company", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      await tx.exec(`insert into office.notes (company_id, title) values ($1, 'Çalışan Taslağı')`, [
        ids.arma,
      ]);
      await tx.setContext(approverA);
      expect(await tx.count('notes', `title = 'Çalışan Taslağı' and status = 'draft'`)).toBe(1);
    });
  });

  it('only the founder sets and clears the source of truth flag', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(
        (
          await tx.expectError(`update office.notes set is_source_of_truth = true where id = $1`, [
            ids.noteA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(
            `insert into office.notes (company_id, title, is_source_of_truth) values ($1, 'x', true)`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(`update office.notes set is_source_of_truth = false where id = $1`, [
            ids.noteASourceOfTruth,
          ])
        ).code,
      ).toBe('42501');
      await tx.setContext(founderA);
      expect(
        await tx.exec(`update office.notes set is_source_of_truth = true where id = $1`, [
          ids.noteA,
        ]),
      ).toBe(1);
    });
  });

  it('an agent cannot change a source of truth note, archive a note or delete it', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(`update office.notes set body = 'x' where id = $1`, [
            ids.noteASourceOfTruth,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(`update office.notes set status = 'archived' where id = $1`, [
            ids.noteA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (await tx.expectError(`delete from office.notes where id = $1`, [ids.noteA])).code,
      ).toBe('42501');
      expect(
        await tx.exec(`update office.notes set body = 'Ajan güncelledi' where id = $1`, [
          ids.noteA,
        ]),
      ).toBe(1);
      expect(
        await tx.rows(
          'select updated_by_agent_code, updated_by_user_id from office.notes where id = $1',
          [ids.noteA],
        ),
      ).toEqual([{ updated_by_agent_code: 'KOR-1', updated_by_user_id: null }]);
    });
  });

  it('an agent cannot mark an externally sourced note or task as internal', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(`update office.notes set source_kind = 'external' where id = $1`, [ids.noteA]);
      await tx.exec(`update office.tasks set source_kind = 'external' where id = $1`, [ids.taskA]);
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(`update office.notes set source_kind = 'internal' where id = $1`, [
            ids.noteA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(`update office.tasks set source_kind = 'internal' where id = $1`, [
            ids.taskA,
          ])
        ).code,
      ).toBe('42501');
    });
  });

  it('every change writes a version; the application cannot write to the version table', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(`update office.notes set body = 'İkinci' where id = $1`, [ids.noteA]);
      await tx.exec(`update office.notes set status = 'active' where id = $1`, [ids.noteA]);
      expect(
        await tx.rows(
          'select version, body from office.note_versions where note_id = $1 order by version',
          [ids.noteA],
        ),
      ).toEqual([
        { version: 1, body: 'Bkz. [[Tek Doğru Kaynak]] ve [[Proje Notu|proje]].' },
        { version: 2, body: 'İkinci' },
      ]);
      expect(
        (
          await tx.expectError(
            `insert into office.note_versions (company_id, note_id, version, folder, title, properties, body, status, is_source_of_truth, source_kind) values ($1, $2, 9, '', 'x', '{}', '', 'active', false, 'internal')`,
            [ids.arma, ids.noteA],
          )
        ).code,
      ).toBe('42501');
      expect((await tx.expectError(`delete from office.note_links`)).code).toBe('42501');
    });
  });

  it('links are extracted when a note is saved; backlink visibility follows the note', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const targets = async () =>
        (
          await tx.rows<{ target_title: string }>(
            'select target_title from office.note_links where source_note_id = $1 order by target_title collate "C"',
            [ids.noteA],
          )
        ).map((r) => r.target_title);
      expect(await targets()).toEqual(['Proje Notu', 'Tek Doğru Kaynak']);
      await tx.exec(
        `update office.notes set body = '[[Yeni Not#Bölüm]] [[ Yeni Not ]] [[Başka|takma]]', properties = '{"ilgili": "[[Özellikteki Not]]"}' where id = $1`,
        [ids.noteA],
      );
      expect(await targets()).toEqual(['Başka', 'Yeni Not', 'Özellikteki Not']);

      // A link from a project note is not visible from outside the project.
      await tx.exec(`update office.notes set body = '[[Genel Not]]' where id = $1`, [
        ids.noteAProject,
      ]);
      expect(await tx.count('note_links', 'source_note_id = $1', [ids.noteAProject])).toBe(1);
      await tx.setContext(approverA);
      expect(await tx.count('note_links', 'source_note_id = $1', [ids.noteAProject])).toBe(0);
    });
  });

  it('Turkish full text search works on notes', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const find = async (query: string) =>
        (
          await tx.rows<{ id: string }>(
            `select id from office.notes where search_vector @@ websearch_to_tsquery('turkish', $1) order by 1`,
            [query],
          )
        ).map((r) => r.id);
      expect(await find('kaynakları')).toContain(ids.noteASourceOfTruth);
      expect(await find('takvimi')).toEqual([ids.noteAShared]);
    });
  });
});

describe.skipIf(noDatabase)('run, task and agent rules', () => {
  afterAll(closePools);

  const openRun = `insert into office.runs (company_id, agent_code, card_version_id, trigger_type, model, user_id)
    values ($1, $2, $3, 'request', 'test-model', $4) returning user_id, label`;

  it('only its own agent context opens a run; the identity comes from the context', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (await tx.expectError(openRun, [ids.arma, 'KOR-1', ids.cardKor, ids.founder])).code,
      ).toBe('42501');
      await tx.setContext(korA);
      expect(
        (await tx.expectError(openRun, [ids.arma, 'HAF-1', ids.cardHaf, ids.founder])).code,
      ).toBe('42501');
      expect(
        (await tx.expectError(openRun, [ids.arma, 'KOR-1', ids.cardHaf, ids.founder])).code,
      ).toBe('23503');
      expect(await tx.rows(openRun, [ids.arma, 'KOR-1', ids.cardKor, ids.employeeA])).toEqual([
        { user_id: ids.founder, label: 'internal' },
      ]);
    });
  });

  it('a stopped agent takes no new work; an agent cannot be enabled in a company not on its card', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'HAF-1' });
      expect(
        (await tx.expectError(openRun, [ids.arma, 'HAF-1', ids.cardHaf, ids.founder])).message,
      ).toMatch(/not enabled/);
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(
            `insert into office.company_agents (company_id, agent_code) values ($1, 'P-IST-1')`,
            [ids.arma],
          )
        ).code,
      ).toBe('23514');
      // Only the founder enables or stops an agent.
      await tx.setContext(employeeA);
      expect(
        await tx.exec(
          `update office.company_agents set status = 'enabled' where agent_code = 'HAF-1'`,
        ),
      ).toBe(0);
      await tx.setContext(founderA);
      expect(
        await tx.exec(
          `update office.company_agents set status = 'stopped' where agent_code = 'KOR-1'`,
        ),
      ).toBe(1);
      await tx.setContext(korA);
      expect(
        (await tx.expectError(openRun, [ids.arma, 'KOR-1', ids.cardKor, ids.founder])).message,
      ).toMatch(/not enabled/);
    });
  });

  it("an agent cannot change another agent's run; a person cannot change a run record", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'HAF-1' });
      expect(
        await tx.exec(`update office.runs set status = 'failed' where id = $1`, [ids.runA]),
      ).toBe(0);
      await tx.setContext(founderA);
      expect(
        await tx.exec(`update office.runs set status = 'failed' where id = $1`, [ids.runA]),
      ).toBe(0);
      expect((await tx.expectError(`delete from office.runs where id = $1`, [ids.runA])).code).toBe(
        '42501',
      );
      await tx.setContext(korA);
      expect(
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = started_at + interval '2 seconds', input_tokens = 10 where id = $1`,
          [ids.runA],
        ),
      ).toBe(1);
      expect(
        await tx.rows('select duration_ms from office.runs where id = $1', [ids.runA]),
      ).toEqual([{ duration_ms: '2000' }]);
      expect(
        (
          await tx.expectError(`update office.runs set user_id = $2 where id = $1`, [
            ids.runA,
            ids.employeeA,
          ])
        ).code,
      ).toBe('23514');
    });
  });

  it('raw content is purged when its retention ends; the summary stays', async () => {
    await inAdminTransaction(async (tx) => {
      // To move the retention end into the past, the immutable columns trigger is disabled in this
      // transaction.
      await tx.exec(`alter table office.runs disable trigger immutable_columns`);
      await tx.exec(`alter table office.tool_calls disable trigger immutable_columns`);
      await tx.exec(
        `update office.runs set input = '{"prompt": "raw"}', summary = 'Summary', raw_retain_until = now() - interval '1 day' where id = $1`,
        [ids.runA],
      );
      await tx.exec(
        `update office.tool_calls set result = '{"raw": true}', raw_retain_until = now() - interval '1 day' where run_id = $1`,
        [ids.runA],
      );
      await tx.exec(`alter table office.runs enable trigger immutable_columns`);
      await tx.exec(`alter table office.tool_calls enable trigger immutable_columns`);
      expect(await tx.rows('select office.purge_raw_content() as n')).toEqual([{ n: 2 }]);
      expect(
        await tx.rows(
          'select input, summary, raw_deleted_at is not null as deleted from office.runs where id = $1',
          [ids.runA],
        ),
      ).toEqual([{ input: null, summary: 'Summary', deleted: true }]);
      expect(await tx.count('tool_calls', 'run_id = $1 and result is null', [ids.runA])).toBe(1);
    });
    // The application role can call the purge; a row whose retention has not ended is not touched.
    await inTransaction(async (tx) => {
      expect(await tx.rows('select office.purge_raw_content() as n')).toEqual([{ n: 0 }]);
    });
  });

  it('an externally sourced task cannot be assigned to an agent; if a person assigns it, it becomes internal', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(`update office.tasks set source_kind = 'external' where id = $1`, [ids.taskA]);
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(
            `update office.tasks set assignee_agent_code = 'KOR-1' where id = $1`,
            [ids.taskA],
          )
        ).code,
      ).toBe('23514');
      await tx.setContext(founderA);
      await tx.exec(`update office.tasks set assignee_agent_code = 'KOR-1' where id = $1`, [
        ids.taskA,
      ]);
      expect(
        await tx.rows('select source_kind from office.tasks where id = $1', [ids.taskA]),
      ).toEqual([{ source_kind: 'internal' }]);
    });
  });

  it('a task is not deleted; completion time and version are kept by the trigger', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (await tx.expectError(`delete from office.tasks where id = $1`, [ids.taskA])).code,
      ).toBe('42501');
      await tx.exec(`update office.tasks set status = 'done', version = 50 where id = $1`, [
        ids.taskA,
      ]);
      expect(
        await tx.rows(
          'select version, completed_at is not null as completed from office.tasks where id = $1',
          [ids.taskA],
        ),
      ).toEqual([{ version: 1, completed: true }]);
      await tx.exec(
        `update office.tasks set status = 'in_progress', title = 'New title' where id = $1`,
        [ids.taskA],
      );
      expect(
        await tx.rows('select version, completed_at from office.tasks where id = $1', [ids.taskA]),
      ).toEqual([{ version: 2, completed_at: null }]);
    });
  });

  it('the comment author comes from the context; a comment cannot be changed', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      await tx.exec(
        `insert into office.task_comments (company_id, task_id, body, author_user_id) values ($1, $2, 'Agent question', $3)`,
        [ids.arma, ids.taskA, ids.employeeA],
      );
      expect(
        await tx.rows(
          `select author_agent_code, author_user_id from office.task_comments where body = 'Agent question'`,
        ),
      ).toEqual([{ author_agent_code: 'KOR-1', author_user_id: null }]);
      expect((await tx.expectError(`update office.task_comments set body = 'x'`)).code).toBe(
        '42501',
      );
    });
  });

  it('the recipient sees and reads a notification; nobody else can see it', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(await tx.count('notifications')).toBe(1);
      expect(await tx.exec(`update office.notifications set read_at = now()`)).toBe(1);
      await tx.setContext(approverA);
      expect(await tx.count('notifications')).toBe(0);
      await tx.setContext(korA);
      expect(await tx.count('notifications')).toBe(1);
      await tx.exec(
        `insert into office.notifications (company_id, recipient_user_id, template) values ($1, $2, 'approval_pending')`,
        [ids.arma, ids.founder],
      );
      expect(
        await tx.rows(
          `select sender_agent_code from office.notifications where template = 'approval_pending'`,
        ),
      ).toEqual([{ sender_agent_code: 'KOR-1' }]);
      // A notification cannot be written to a person who is not a member of the company.
      expect(
        (
          await tx.expectError(
            `insert into office.notifications (company_id, recipient_user_id, template) values ($1, $2, 'x')`,
            [ids.arma, ids.employeeP],
          )
        ).code,
      ).toBe('23503');
    });
  });

  it("a generated file's path starts with the company id", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const insert = (path: string) =>
        tx.expectError(
          `insert into office.files (company_id, name, mime_type, size_bytes, storage_path) values ($1, 'x', 'text/plain', 1, $2)`,
          [ids.arma, path],
        );
      expect((await insert(`${ids.pillika}/x.txt`)).code).toBe('23514');
      expect((await insert(`${ids.arma}/../${ids.pillika}/x.txt`)).code).toBe('23514');
    });
  });
});

describe.skipIf(noDatabase)('audit log', () => {
  afterAll(closePools);

  it('an audit_log row cannot be changed or deleted (application role)', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect((await tx.expectError(`update office.audit_log set event = 'changed'`)).code).toBe(
        '42501',
      );
      expect((await tx.expectError(`delete from office.audit_log`)).code).toBe('42501');
      expect((await tx.expectError(`truncate office.audit_log`)).code).toBe('42501');
    });
  });

  it('an audit_log row cannot be changed or deleted with the privileged role either', async () => {
    await inAdminTransaction(async (tx) => {
      expect(
        (await tx.expectError(`update office.audit_log set event = 'changed'`)).message,
      ).toMatch(/cannot be changed or deleted/);
      expect((await tx.expectError(`delete from office.audit_log`)).message).toMatch(
        /cannot be changed or deleted/,
      );
      expect((await tx.expectError(`truncate office.audit_log cascade`)).message).toMatch(
        /cannot be changed or deleted/,
      );
    });
  });

  it('who and when come from the context; free text cannot be written; the founder reads the log', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      await tx.exec(
        `insert into office.audit_log (company_id, event, tool_name, run_id, user_id, external_ref) values ($1, 'tool_call', $2, $3, $4, 'msg-18c2f3a9')`,
        [ids.arma, TOOL.read, ids.runA, ids.employeeA],
      );
      expect(
        (
          await tx.expectError(
            `insert into office.audit_log (company_id, event, external_ref) values ($1, 'tool_call', 'Mr Ahmet did not like the proposal')`,
            [ids.arma],
          )
        ).code,
      ).toBe('23514');
      expect(await tx.count('audit_log')).toBe(0);
      await tx.setContext(employeeA);
      expect(await tx.count('audit_log')).toBe(0);
      await tx.setContext(founderA);
      expect(
        await tx.rows(`select user_id, agent_code from office.audit_log where event = 'tool_call'`),
      ).toEqual([{ user_id: ids.founder, agent_code: 'KOR-1' }]);
    });
  });
});
