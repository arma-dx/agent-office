import {
  listExpectedRequests,
  listNotifications,
  markNotificationsRead,
  peopleNames,
} from '@agent-office/db';
import {
  COORDINATOR_AGENT_CODE,
  NOTIFICATION_KEEP_DAYS,
  NOTIFICATION_LIST_LIMIT,
  TODAY_REQUEST_LIMIT,
  markNotificationsReadSchema,
  sidebarCountsSchema,
  todaySchema,
  type RequestSummary,
  type SidebarCounts,
  type Today,
} from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import type { CompanyContext } from '../db.ts';
import { invalidRequest } from '../errors.ts';
import { peopleOf, toSummary, type Names, type Reader } from '../requests-view.ts';
import type { RouteDeps } from '../services.ts';
import { expectedKind, toNotification, type ExpectedKind } from '../today-view.ts';

/**
 * The Bugün screen (8 October decisions 7 and 8).
 *
 *   GET  /api/today               what is expected of the person in the selected company, and
 *                                 the person's notifications there
 *   GET  /api/today/counts        the two numbers of the sidebar: Bugün and Onaylar
 *   POST /api/notifications/read  the person marks notifications read
 *
 * Nothing here decides, routes or closes: an expected item leads to the page of its request,
 * where the act is done. What is expected is derived from the records of the flow with the one
 * function that says where a request is (deriveStage); nothing is stored and no second rule
 * exists. A notification is written by the database in the transaction of its event, never here.
 *
 * GET /api/today is for every member: an external person has no request (the list is empty
 * without a question to the database) but reads their own notifications, such as a passkey reset.
 * The counts are for the founder and employees, like every route of a request.
 */

const MEMBERS = { founderOnly: false } as const;
const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

const NO_NAMES: Names = new Map();

interface ExpectedItem {
  kind: ExpectedKind;
  summary: RequestSummary;
}

interface Expected {
  items: ExpectedItem[];
  truncated: boolean;
}

// An external person has no request (the run's identity must be an insider): nothing is asked.
const NOTHING_EXPECTED: Expected = { items: [], truncated: false };

/**
 * What waits for the reader, the one that has not moved for longest first. With `named` false the
 * names of people are not read: the counts need none (whose turn it is does not depend on a name).
 */
async function expectedOf(context: CompanyContext, now: Date, named: boolean): Promise<Expected> {
  const { client } = context;
  const reader: Reader = { userId: context.session.userId, role: context.role };
  const rows = await listExpectedRequests(client, {
    coordinator: COORDINATOR_AGENT_CODE,
    limit: TODAY_REQUEST_LIMIT + 1,
  });
  const kept = rows.slice(0, TODAY_REQUEST_LIMIT).flatMap((row) => {
    const kind = expectedKind(row, toSummary(row, reader, NO_NAMES, now));
    return kind === null ? [] : [{ row, kind }];
  });
  const names = named
    ? await peopleNames(
        client,
        kept.flatMap(({ row }) => peopleOf(row)),
      )
    : NO_NAMES;
  return {
    items: kept.map(({ row, kind }) => ({ kind, summary: toSummary(row, reader, names, now) })),
    truncated: rows.length > TODAY_REQUEST_LIMIT,
  };
}

export function registerTodayRoutes(app: FastifyInstance, { runner }: RouteDeps): void {
  app.get('/api/today', async (request, reply): Promise<Today> =>
    runner.withCompany(request, reply, MEMBERS, async (context) => {
      const expected =
        context.role === 'external'
          ? NOTHING_EXPECTED
          : await expectedOf(context, new Date(), true);
      const rows = await listNotifications(context.client, {
        keepDays: NOTIFICATION_KEEP_DAYS,
        limit: NOTIFICATION_LIST_LIMIT + 1,
      });
      return todaySchema.parse({
        expected: expected.items.map((item) => item.summary),
        expectedTruncated: expected.truncated,
        notifications: rows.slice(0, NOTIFICATION_LIST_LIMIT).flatMap((row) => {
          const notification = toNotification(row);
          return notification === null ? [] : [notification];
        }),
        notificationsTruncated: rows.length > NOTIFICATION_LIST_LIMIT,
      });
    }),
  );

  app.get('/api/today/counts', async (request, reply): Promise<SidebarCounts> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const { items } = await expectedOf(context, new Date(), false);
      return sidebarCountsSchema.parse({
        today: items.length,
        approvals: items.filter((item) => item.kind !== 'fallen').length,
      });
    }),
  );

  app.post('/api/notifications/read', async (request, reply) => {
    await runner.withCompany(request, reply, MEMBERS, async ({ client }) => {
      const body = markNotificationsReadSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      // Marks only the reader's own; an id of somebody else changes nothing and says nothing.
      await markNotificationsRead(client, body.data.ids);
    });
    return reply.code(204).send();
  });
}
