import type { Queryable } from './queryable.ts';

/** One agent of the context company with its unit and the company's switch for it. */
export interface OfficeRow {
  unit_code: string;
  unit_name: string;
  agent_code: string;
  agent_name: string;
  // company_agents.status; null when the company has no row for the agent.
  status: string | null;
  // The agent's card has a version to run with. Without one the agent cannot be opened: it could
  // be given a request and would never start (office.flow_route_request asks the same).
  ready: boolean;
}

// Only the switch is read from company_agents: its settings and budget never leave the database
// through this query. Of the card only whether a version exists, never the version or its content. Units shared by every company come first, then the company's own, each by
// code; agents by the number at the end of their code, so KOR-10 follows KOR-9. The number is read
// as numeric: the code pattern does not limit its digits, and one that is too large for an integer
// would fail the whole query. The "C" collation keeps the order independent of the database locale.
const OFFICE_SQL = `
  select u.code as unit_code,
         u.name as unit_name,
         a.code as agent_code,
         a.name as agent_name,
         ca.status,
         a.current_version_id is not null as ready
  from office.companies c
  join office.agent_definitions a on c.code = any (a.company_codes)
  join office.units u on u.code = a.unit_code
  left join office.company_agents ca on ca.company_id = c.id and ca.agent_code = a.code
  where c.id = office.ctx_company_id()
    and (u.company_code is null or u.company_code = c.code)
  order by (u.company_code is not null),
           u.code collate "C",
           substring(a.code from '[0-9]+$')::numeric,
           a.code collate "C"`;

/**
 * Units and agents of the context company. The global tables have no row level security, so the
 * company filter is this join: the context company's row in office.companies is visible only to
 * its members, and its code selects the units and agents. No context, or a person who is not a
 * member, gives no row. An external person is a member: the caller refuses them by role.
 *
 * A unit without an agent for the company gives no row (inner join). An agent whose card names the
 * company but whose unit belongs to another company is left out; the definitions sync refuses such
 * a card, and the query does not rely on that.
 */
export async function readOffice(client: Queryable): Promise<OfficeRow[]> {
  const { rows } = await client.query<OfficeRow>(OFFICE_SQL);
  return rows;
}
