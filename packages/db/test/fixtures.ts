import type pg from 'pg';

// Fixed ids of the fixtures (in valid v4 format).
function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

export const ids = {
  arma: id(1),
  pillika: id(2),
  founderSpace: id(3),
  // A company the founder is not a member of, run by another founder (for account management
  // tests).
  otherCompany: id(4),

  founder: id(11),
  employeeA: id(12),
  employeeP: id(13),
  externalA: id(14),
  approverA: id(15),
  externalP: id(16),
  // The founder of the other company, and a person who works both at Arma DX and at the other
  // company.
  otherFounder: id(17),
  sharedEmployee: id(18),
  // A person who is a member of no company (has left).
  formerEmployee: id(19),

  customerA: id(21),
  customerANoAi: id(22),
  customerP: id(23),

  projectA: id(31),
  projectANoAi: id(32),
  projectACustomerNoAi: id(33),
  projectP: id(34),

  taskA: id(51),
  taskAProject: id(52),
  taskANoAiProject: id(53),
  taskAShared: id(54),
  taskP: id(55),
  taskPProject: id(56),
  taskFounderSpace: id(57),

  cardKor: id(61),
  cardHaf: id(62),
  cardPist: id(63),

  runA: id(71),
  runAProject: id(72),
  runP: id(73),

  noteA: id(81),
  noteAProject: id(82),
  noteASourceOfTruth: id(83),
  noteAShared: id(84),
  noteP: id(85),
  notePProject: id(86),

  approvalA: id(91),
  approvalAProject: id(92),
  approvalP: id(93),
  approvalAApproved: id(94),
  approvalPApproved: id(95),

  invitationA: id(101),
  invitationP: id(102),
} as const;

export const TOOL = {
  read: 'read_task',
  internalWrite: 'update_note',
  externalEffect: 'send_email',
} as const;

function contextSql(
  company: string,
  user: string,
  agent: string | null = null,
  project: string | null = null,
): string {
  return `select
    set_config('app.company_id', '${company}', true),
    set_config('app.user_id', '${user}', true),
    set_config('app.agent_code', '${agent ?? ''}', true),
    set_config('app.project_id', '${project ?? ''}', true);`;
}

/**
 * Fixtures with at least one row per table for both companies (and the founder space).
 * Loaded with the privileged role; triggers need a context, so the context is set step by step.
 * Note titles and bodies stay Turkish: they are the content of the company memory and the full text
 * search test uses the Turkish dictionary.
 */
export async function loadFixtures(client: pg.Client): Promise<void> {
  const sql = `
    insert into office.companies (id, code, name, kind) values
      ('${ids.arma}', 'armadx', 'Arma DX', 'company'),
      ('${ids.pillika}', 'pillika', 'Pillika', 'company'),
      ('${ids.founderSpace}', 'founder_space', 'Kurucu', 'private_space'),
      ('${ids.otherCompany}', 'other', 'Başka Şirket', 'company');

    insert into office.users (id, name) values
      ('${ids.founder}', 'Kurucu'),
      ('${ids.employeeA}', 'Çalışan A'),
      ('${ids.employeeP}', 'Çalışan P'),
      ('${ids.externalA}', 'Mali Müşavir'),
      ('${ids.approverA}', 'Yetkili Çalışan A'),
      ('${ids.externalP}', 'Avukat'),
      ('${ids.otherFounder}', 'Başka Kurucu'),
      ('${ids.sharedEmployee}', 'Ortak Çalışan'),
      ('${ids.formerEmployee}', 'Eski Çalışan');

    -- The founder has two accounts; both log in as the same user.
    insert into office.user_emails (email, user_id) values
      ('founder@arma.test', '${ids.founder}'),
      ('founder@pillika.test', '${ids.founder}'),
      ('employee.a@example.test', '${ids.employeeA}'),
      ('employee.p@example.test', '${ids.employeeP}'),
      ('accountant@example.test', '${ids.externalA}'),
      ('approver.a@example.test', '${ids.approverA}'),
      ('lawyer@example.test', '${ids.externalP}'),
      ('founder@other.test', '${ids.otherFounder}'),
      ('shared@example.test', '${ids.sharedEmployee}'),
      ('former@example.test', '${ids.formerEmployee}');

    insert into office.memberships (company_id, user_id, role, can_approve) values
      ('${ids.arma}', '${ids.founder}', 'founder', true),
      ('${ids.pillika}', '${ids.founder}', 'founder', true),
      ('${ids.founderSpace}', '${ids.founder}', 'founder', true),
      ('${ids.arma}', '${ids.employeeA}', 'employee', false),
      ('${ids.arma}', '${ids.approverA}', 'employee', true),
      ('${ids.arma}', '${ids.externalA}', 'external', false),
      ('${ids.pillika}', '${ids.employeeP}', 'employee', false),
      ('${ids.pillika}', '${ids.externalP}', 'external', false),
      ('${ids.otherCompany}', '${ids.otherFounder}', 'founder', true),
      ('${ids.otherCompany}', '${ids.sharedEmployee}', 'employee', false),
      ('${ids.arma}', '${ids.sharedEmployee}', 'employee', false);

    insert into office.units (code, name, company_code, pilot_enabled) values
      ('KOR', 'Koordinasyon Katmanı', null, true),
      ('HAF', 'Kurumsal Hafıza', null, true),
      ('A-KES', 'Keşif ve Dönüşüm Danışmanlığı', 'armadx', true),
      ('P-IST', 'İstasyon Verisi ve Şarj Operasyonları', 'pillika', true);

    insert into office.agent_definitions (code, name, unit_code, company_codes) values
      ('KOR-1', 'Ofis Koordinatörü', 'KOR', '{armadx,pillika}'),
      ('HAF-1', 'Bilgi Düzenleme', 'HAF', '{armadx,pillika}'),
      ('P-IST-1', 'İstasyon Veri Toplama', 'P-IST', '{pillika}');

    insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
    values
      ('${ids.cardKor}', 'KOR-1', 'abc1234', '{}', 'Y2', 'test-model'),
      ('${ids.cardHaf}', 'HAF-1', 'abc1234', '{}', 'Y1', 'test-model'),
      ('${ids.cardPist}', 'P-IST-1', 'abc1234', '{}', 'Y2', 'test-model');
    update office.agent_definitions set current_version_id = '${ids.cardKor}' where code = 'KOR-1';

    insert into office.tools (name, kind, description) values
      ('${TOOL.read}', 'read', 'Reads a task'),
      ('${TOOL.internalWrite}', 'internal_write', 'Changes a note'),
      ('${TOOL.externalEffect}', 'external_effect', 'Sends an email');

    insert into office.company_agents (company_id, agent_code, status) values
      ('${ids.arma}', 'KOR-1', 'enabled'),
      ('${ids.pillika}', 'KOR-1', 'enabled'),
      ('${ids.arma}', 'HAF-1', 'stopped'),
      ('${ids.pillika}', 'P-IST-1', 'enabled');

    -- Only the founder grants AI permission; customers are added in the founder's context.
    ${contextSql(ids.arma, ids.founder)}
    insert into office.customers (id, company_id, name, ai_allowed) values
      ('${ids.customerA}', '${ids.arma}', 'Customer with AI permission', true),
      ('${ids.customerANoAi}', '${ids.arma}', 'Customer without AI permission', false);
    ${contextSql(ids.pillika, ids.founder)}
    insert into office.customers (id, company_id, name, ai_allowed) values
      ('${ids.customerP}', '${ids.pillika}', 'Pillika customer', true);

    insert into office.opportunities (company_id, customer_id, name) values
      ('${ids.arma}', '${ids.customerA}', 'Opportunity A'),
      ('${ids.arma}', '${ids.customerANoAi}', 'Opportunity without AI permission'),
      ('${ids.pillika}', '${ids.customerP}', 'Opportunity P');

    insert into office.projects (id, company_id, customer_id, name, ai_allowed) values
      ('${ids.projectA}', '${ids.arma}', '${ids.customerA}', 'Project A', true),
      ('${ids.projectANoAi}', '${ids.arma}', null, 'Project without AI permission', false),
      ('${ids.projectACustomerNoAi}', '${ids.arma}', '${ids.customerANoAi}',
        'Project whose customer has no AI permission', true),
      ('${ids.projectP}', '${ids.pillika}', '${ids.customerP}', 'Project P', true);

    insert into office.project_members (company_id, project_id, user_id) values
      ('${ids.arma}', '${ids.projectA}', '${ids.employeeA}'),
      ('${ids.arma}', '${ids.projectANoAi}', '${ids.employeeA}'),
      ('${ids.pillika}', '${ids.projectP}', '${ids.employeeP}');

    insert into office.work_types (company_id, code, name, baseline_minutes) values
      ('${ids.arma}', 'proposal', 'Preparing a proposal', 240),
      ('${ids.pillika}', 'social_post', 'Social media post', 60);

    insert into office.tasks (id, company_id, project_id, title, unit_code) values
      ('${ids.taskA}', '${ids.arma}', null, 'General task A', 'KOR'),
      ('${ids.taskAProject}', '${ids.arma}', '${ids.projectA}', 'Project task A', 'A-KES'),
      ('${ids.taskANoAiProject}', '${ids.arma}', '${ids.projectANoAi}',
        'Task of the project without AI permission', 'A-KES'),
      ('${ids.taskAShared}', '${ids.arma}', null, 'Task shared with the accountant', 'KOR'),
      ('${ids.taskP}', '${ids.pillika}', null, 'General task P', 'KOR'),
      ('${ids.taskPProject}', '${ids.pillika}', '${ids.projectP}', 'Project task P', 'P-IST'),
      ('${ids.taskFounderSpace}', '${ids.founderSpace}', null, 'Founder space task', 'KOR');

    insert into office.access_grants (company_id, user_id, record_type, record_id) values
      ('${ids.arma}', '${ids.externalA}', 'task', '${ids.taskAShared}'),
      ('${ids.arma}', '${ids.externalA}', 'note', '${ids.noteAShared}'),
      ('${ids.pillika}', '${ids.externalP}', 'task', '${ids.taskP}');

    ${contextSql(ids.arma, ids.founder)}
    insert into office.task_comments (company_id, task_id, body) values
      ('${ids.arma}', '${ids.taskA}', 'General comment'),
      ('${ids.arma}', '${ids.taskAProject}', 'Project comment'),
      ('${ids.arma}', '${ids.taskAShared}', 'Comment shared with the accountant');
    insert into office.notes (id, company_id, project_id, title, body, status, is_source_of_truth)
    values
      ('${ids.noteA}', '${ids.arma}', null, 'Genel Not',
        'Bkz. [[Tek Doğru Kaynak]] ve [[Proje Notu|proje]].', 'active', false),
      ('${ids.noteAProject}', '${ids.arma}', '${ids.projectA}', 'Proje Notu', 'Proje içeriği',
        'active', false),
      ('${ids.noteASourceOfTruth}', '${ids.arma}', null, 'Tek Doğru Kaynak', 'Kaynak listesi',
        'active', true),
      ('${ids.noteAShared}', '${ids.arma}', null, 'Müşavir Notu', 'Beyanname takvimi', 'active',
        false);
    insert into office.notifications
      (company_id, recipient_user_id, template, record_type, record_id)
      values ('${ids.arma}', '${ids.employeeA}', 'task_assigned', 'task', '${ids.taskA}');
    insert into office.station_candidates (company_id, source)
      values ('${ids.arma}', 'test-source');
    insert into office.integrations (company_id, provider, account, encrypted_token)
      values ('${ids.arma}', 'google', 'arma-account', '\\x00');
    insert into office.audit_log (company_id, event, record_type, record_id)
      values ('${ids.arma}', 'task_created', 'task', '${ids.taskA}');
    insert into office.invitations (id, company_id, email, role, can_approve)
      values ('${ids.invitationA}', '${ids.arma}', 'invitee.a@example.test', 'employee', true);

    ${contextSql(ids.pillika, ids.founder)}
    insert into office.task_comments (company_id, task_id, body) values
      ('${ids.pillika}', '${ids.taskP}', 'Pillika comment');
    insert into office.notes (id, company_id, project_id, title, body, status) values
      ('${ids.noteP}', '${ids.pillika}', null, 'Pillika Notu', 'Bkz. [[Pillika Proje Notu]]',
        'active'),
      ('${ids.notePProject}', '${ids.pillika}', '${ids.projectP}', 'Pillika Proje Notu', 'İçerik',
        'active');
    insert into office.notifications (company_id, recipient_user_id, template) values
      ('${ids.pillika}', '${ids.employeeP}', 'daily_summary');
    insert into office.station_candidates (company_id, source, is_closed)
      values ('${ids.pillika}', 'open-data', false);
    insert into office.integrations (company_id, provider, account, encrypted_token)
      values ('${ids.pillika}', 'google', 'pillika-account', '\\x00');
    insert into office.audit_log (company_id, event) values ('${ids.pillika}', 'login');
    insert into office.invitations (id, company_id, email, role)
      values ('${ids.invitationP}', '${ids.pillika}', 'invitee.p@example.test', 'external');

    insert into office.documents (company_id, drive_file_id, name, source_note_id) values
      ('${ids.arma}', 'drive_file_arma_1', 'Contract', '${ids.noteA}'),
      ('${ids.pillika}', 'drive_file_pillika_1', 'Source list', '${ids.noteP}');

    ${contextSql(ids.arma, ids.founder, 'KOR-1')}
    insert into office.runs
        (id, company_id, task_id, agent_code, card_version_id, trigger_type, model)
      values ('${ids.runA}', '${ids.arma}', '${ids.taskA}', 'KOR-1', '${ids.cardKor}', 'request',
        'test-model');
    insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
      values ('${ids.arma}', '${ids.runA}', 1, '${TOOL.read}', 'succeeded');
    insert into office.files (company_id, run_id, name, mime_type, size_bytes, storage_path)
      values ('${ids.arma}', '${ids.runA}', 'report.pdf', 'application/pdf', 10,
        '${ids.arma}/report.pdf');
    insert into office.approvals (id, company_id, run_id, task_id, agent_code, title, payload,
        basis_type, basis_id, basis_version)
      values ('${ids.approvalA}', '${ids.arma}', '${ids.runA}', '${ids.taskA}', 'KOR-1',
        'Note change', '{}', 'note', '${ids.noteA}', 1);
    insert into office.approvals (id, company_id, run_id, agent_code, title, payload, tool_name)
      values ('${ids.approvalAApproved}', '${ids.arma}', '${ids.runA}', 'KOR-1', 'Email', '{}',
        '${TOOL.externalEffect}');

    ${contextSql(ids.arma, ids.founder, 'KOR-1', ids.projectA)}
    insert into office.runs
        (id, company_id, task_id, agent_code, card_version_id, trigger_type, model)
      values ('${ids.runAProject}', '${ids.arma}', '${ids.taskAProject}', 'KOR-1', '${ids.cardKor}',
        'request', 'test-model');
    insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
      values ('${ids.arma}', '${ids.runAProject}', 1, '${TOOL.read}', 'succeeded');
    insert into office.approvals (id, company_id, run_id, task_id, agent_code, title, payload)
      values ('${ids.approvalAProject}', '${ids.arma}', '${ids.runAProject}', '${ids.taskAProject}',
        'KOR-1', 'Project output', '{}');

    ${contextSql(ids.pillika, ids.founder, 'KOR-1')}
    insert into office.runs
        (id, company_id, task_id, agent_code, card_version_id, trigger_type, model)
      values ('${ids.runP}', '${ids.pillika}', '${ids.taskP}', 'KOR-1', '${ids.cardKor}', 'request',
        'test-model');
    insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
      values ('${ids.pillika}', '${ids.runP}', 1, '${TOOL.read}', 'succeeded');
    insert into office.files (company_id, run_id, name, mime_type, size_bytes, storage_path)
      values ('${ids.pillika}', '${ids.runP}', 'image.png', 'image/png', 10,
        '${ids.pillika}/image.png');
    insert into office.approvals (id, company_id, run_id, agent_code, title, payload)
      values ('${ids.approvalP}', '${ids.pillika}', '${ids.runP}', 'KOR-1', 'Pillika output', '{}');
    insert into office.approvals (id, company_id, run_id, agent_code, title, payload)
      values ('${ids.approvalPApproved}', '${ids.pillika}', '${ids.runP}', 'KOR-1',
        'Pillika approved', '{}');

    ${contextSql(ids.arma, ids.founder)}
    update office.approvals set status = 'approved' where id = '${ids.approvalAApproved}';
    insert into office.critical_errors (company_id, approval_id, agent_code, reason,
        flagged_by_user_id)
      values ('${ids.arma}', '${ids.approvalAApproved}', 'KOR-1', 'Wrong recipient',
        '${ids.founder}');

    ${contextSql(ids.pillika, ids.founder)}
    update office.approvals set status = 'approved' where id = '${ids.approvalPApproved}';
    insert into office.critical_errors (company_id, approval_id, agent_code, reason,
        flagged_by_user_id)
      values ('${ids.pillika}', '${ids.approvalPApproved}', 'KOR-1', 'Wrong price',
        '${ids.founder}');
  `;
  await client.query(sql);
}
