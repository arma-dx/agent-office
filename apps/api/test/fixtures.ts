// Fixed ids of the API test fixtures (in valid v4 format).
function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

export const ids = {
  arma: id(1),
  pillika: id(2),
  founderSpace: id(3),
  otherCompany: id(4),

  founder: id(11),
  employee: id(12),
  external: id(13),
  lawyer: id(14),
  leaver: id(15),
  changer: id(16),
  traveller: id(17),
  otherFounder: id(18),
  // Passkey tests (id 19 is the members test's second founder).
  holder: id(20),
  newcomer: id(21),
  // Passkey reset tests: a person whose passkeys a founder resets, and a person who is also a
  // member of a company the Arma DX founder does not run.
  resettee: id(22),
  shared: id(23),

  invitation: id(101),
} as const;

/**
 * A Google account of the fixtures: its address, its Google account id (sub) and the Workspace
 * domain (hd) Google reports for it. COMPANY_EMAIL_DOMAINS in the tests is armadx.test and
 * pillika.test.
 */
export interface Account {
  email: string;
  sub: string;
  hd?: string;
}

export const accounts = {
  founder: { email: 'founder@armadx.test', sub: 'sub-founder', hd: 'armadx.test' },
  employee: { email: 'employee@armadx.test', sub: 'sub-employee', hd: 'armadx.test' },
  // External persons: a Gmail address, and an address of another Workspace.
  external: { email: 'external@gmail.com', sub: 'sub-external' },
  lawyer: { email: 'lawyer@lawfirm.test', sub: 'sub-lawyer', hd: 'lawfirm.test' },
  leaver: { email: 'leaver@armadx.test', sub: 'sub-leaver', hd: 'armadx.test' },
  changer: { email: 'changer@armadx.test', sub: 'sub-changer', hd: 'armadx.test' },
  traveller: { email: 'traveller@armadx.test', sub: 'sub-traveller', hd: 'armadx.test' },
  otherFounder: { email: 'founder@other.test', sub: 'sub-other-founder', hd: 'other.test' },
  holder: { email: 'holder@armadx.test', sub: 'sub-holder', hd: 'armadx.test' },
  newcomer: { email: 'newcomer@armadx.test', sub: 'sub-newcomer', hd: 'armadx.test' },
  resettee: { email: 'resettee@armadx.test', sub: 'sub-resettee', hd: 'armadx.test' },
  // Has the pending invitation of the fixtures; no account yet.
  invitee: { email: 'invitee@gmail.com', sub: 'sub-invitee' },
  // Neither invited nor a member.
  stranger: { email: 'stranger@gmail.com', sub: 'sub-stranger' },
} as const satisfies Record<string, Account>;

interface Client {
  query(sql: string): Promise<unknown>;
}

/** Loaded with the privileged role; the invitation trigger reads the inviter from the context. */
export async function loadFixtures(client: Client): Promise<void> {
  await client.query(`
    insert into office.companies (id, code, name, kind) values
      ('${ids.arma}', 'armadx', 'Arma DX', 'company'),
      ('${ids.pillika}', 'pillika', 'Pillika', 'company'),
      ('${ids.founderSpace}', 'founder_space', 'Kurucu', 'private_space'),
      ('${ids.otherCompany}', 'other', 'Başka Şirket', 'company');

    insert into office.users (id, name) values
      ('${ids.founder}', 'Kurucu'),
      ('${ids.employee}', 'Çalışan'),
      ('${ids.external}', 'Mali Müşavir'),
      ('${ids.lawyer}', 'Avukat'),
      ('${ids.leaver}', 'Ayrılacak Çalışan'),
      ('${ids.changer}', 'Rolü Değişecek Çalışan'),
      ('${ids.traveller}', 'Gezgin Çalışan'),
      ('${ids.otherFounder}', 'Başka Kurucu'),
      ('${ids.holder}', 'Passkey Sahibi'),
      ('${ids.newcomer}', 'Yeni Çalışan'),
      ('${ids.resettee}', 'Passkey Kaybeden Çalışan'),
      ('${ids.shared}', 'İki Şirketin Danışmanı');

    insert into office.user_emails (email, user_id) values
      ('${accounts.founder.email}', '${ids.founder}'),
      ('${accounts.employee.email}', '${ids.employee}'),
      ('${accounts.external.email}', '${ids.external}'),
      ('${accounts.lawyer.email}', '${ids.lawyer}'),
      ('${accounts.leaver.email}', '${ids.leaver}'),
      ('${accounts.changer.email}', '${ids.changer}'),
      ('${accounts.traveller.email}', '${ids.traveller}'),
      ('${accounts.otherFounder.email}', '${ids.otherFounder}'),
      ('${accounts.holder.email}', '${ids.holder}'),
      ('${accounts.newcomer.email}', '${ids.newcomer}'),
      ('${accounts.resettee.email}', '${ids.resettee}');

    insert into office.memberships (company_id, user_id, role, can_approve) values
      ('${ids.arma}', '${ids.founder}', 'founder', true),
      ('${ids.pillika}', '${ids.founder}', 'founder', true),
      ('${ids.founderSpace}', '${ids.founder}', 'founder', true),
      ('${ids.arma}', '${ids.employee}', 'employee', false),
      ('${ids.arma}', '${ids.external}', 'external', false),
      ('${ids.arma}', '${ids.lawyer}', 'external', false),
      ('${ids.arma}', '${ids.leaver}', 'employee', false),
      ('${ids.arma}', '${ids.changer}', 'employee', true),
      ('${ids.arma}', '${ids.traveller}', 'employee', false),
      ('${ids.arma}', '${ids.holder}', 'employee', false),
      ('${ids.arma}', '${ids.newcomer}', 'employee', false),
      ('${ids.arma}', '${ids.resettee}', 'employee', false),
      ('${ids.arma}', '${ids.shared}', 'external', false),
      ('${ids.otherCompany}', '${ids.shared}', 'external', false),
      ('${ids.otherCompany}', '${ids.otherFounder}', 'founder', true);

    -- The founder's invitation, prepared without the passkey re-verification an invitation needs
    -- (the trigger is off for this insert only).
    select set_config('app.company_id', '${ids.arma}', true),
           set_config('app.user_id', '${ids.founder}', true);
    alter table office.invitations disable trigger require_step_up;
    insert into office.invitations (id, company_id, email, role, can_approve)
      values ('${ids.invitation}', '${ids.arma}', '${accounts.invitee.email}', 'employee', false);
    alter table office.invitations enable trigger require_step_up;
  `);
}
