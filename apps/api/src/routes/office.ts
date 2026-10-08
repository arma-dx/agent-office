import { listOpenRequests, readOffice, type OfficeRow } from '@agent-office/db';
import {
  COORDINATOR_AGENT_CODE,
  OFFICE_REQUEST_LIMIT,
  officeResponseSchema,
  type OfficeResponse,
} from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import { officeLive } from '../office-view.ts';
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
 *
 * The answer also says what the desks show (8 October decision 10): for each agent how many open
 * requests it is working on, how many of its results wait for approval and how many fell to a
 * person because of its run. The requests are read with the reader's own rights (a request inside
 * a project the reader is not a member of is not counted; docs/SONRA.md W-e) and each one's stage
 * is derived by the one function the request page and the Bugün list use (deriveStage), so the
 * office cannot say something else than they do. Nothing is stored.
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

/** A unit with its agents as the rows give them; the response schema checks the values. */
interface GroupedUnit {
  code: string;
  name: string;
  agents: { code: string; name: string; status: string | null; ready: boolean }[];
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
    unit.agents.push({
      code: row.agent_code,
      name: row.agent_name,
      status: row.status,
      ready: row.ready,
    });
  }
  return units;
}

export function registerOfficeRoutes(app: FastifyInstance, { runner }: RouteDeps): void {
  app.get('/api/office', async (request, reply): Promise<OfficeResponse> =>
    runner.withCompany(request, reply, INSIDERS, async ({ client }) => {
      const units = groupOffice(await readOffice(client));
      // The open requests the reader may read, with the facts the stage is derived from. One more
      // than the limit is asked for, to know whether the numbers are whole.
      const open = await listOpenRequests(client, {
        coordinator: COORDINATOR_AGENT_CODE,
        limit: OFFICE_REQUEST_LIMIT + 1,
      });
      return officeResponseSchema.parse({
        units,
        ...officeLive(
          open,
          units.flatMap((unit) => unit.agents.map((agent) => agent.code)),
          new Date(),
        ),
      });
    }),
  );
}
