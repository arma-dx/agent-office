import { readOffice, type OfficeRow } from '@agent-office/db';
import { officeResponseSchema, type OfficeResponse } from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../services.ts';

/**
 * Office view (module M15): the units and agents of the selected company with the company's switch
 * for each agent. The founder and employees see it; an external person does not (6 October
 * decision 6). Nothing is read from the request but the company header, which the runner checks
 * against the person's memberships.
 *
 * The units and agents live in global tables without row level security, so two things keep the
 * answer inside the company: the query joins them to the context company's own row, which only its
 * members can see, and the role check below refuses an external member.
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

/** A unit with its agents as the rows give them; the response schema checks the values. */
interface GroupedUnit {
  code: string;
  name: string;
  agents: { code: string; name: string; status: string | null }[];
}

/** Groups the rows (ordered by unit) into units with their agents, keeping the order. */
export function groupOffice(rows: readonly OfficeRow[]): GroupedUnit[] {
  const units: GroupedUnit[] = [];
  for (const row of rows) {
    let unit = units.at(-1);
    if (unit?.code !== row.unit_code) {
      unit = { code: row.unit_code, name: row.unit_name, agents: [] };
      units.push(unit);
    }
    unit.agents.push({ code: row.agent_code, name: row.agent_name, status: row.status });
  }
  return units;
}

export function registerOfficeRoutes(app: FastifyInstance, { runner }: RouteDeps): void {
  app.get('/api/office', async (request, reply): Promise<OfficeResponse> =>
    runner.withCompany(request, reply, INSIDERS, async ({ client }) =>
      officeResponseSchema.parse({ units: groupOffice(await readOffice(client)) }),
    ),
  );
}
