import type { Queryable } from './queryable.ts';

/**
 * The notifications of the Bugün screen. Rows are written by the database itself: the flow of a
 * request (request_returned, request_rejected, request_stopped) and the passkey reset
 * (passkeys_reset). Nothing here writes one.
 *
 * A notification is read by its recipient and by nobody else through these statements. The row
 * policies of the table also show the company's whole log to the founder and to agent runs (so
 * that a notification is not sent twice); that wider view must never reach a screen, so the
 * statement names the reader itself instead of relying on a policy to choose the rows.
 */

export interface NotificationRow {
  id: string;
  template: string;
  created_at: Date;
  read: boolean;
  // The request of a flow notification, when the reader can still read it.
  request_id: string | null;
  request_title: string | null;
  // The unit that had no open agent, for a returned request.
  unit_code: string | null;
  unit_name: string | null;
}

/**
 * The calling person's notifications in the context company, the newest first: the unread ones
 * whatever their age, the read ones of the last `keepDays` days. Only the templates the panel has
 * a sentence for. A flow notification is listed only while the reader can read its request (the
 * row policy of the task decides: a requester taken out of the project, or made an external
 * person, no longer reads it) and only when the request is the reader's own. Never in an agent
 * run.
 */
export async function listNotifications(
  client: Queryable,
  options: { keepDays: number; limit: number },
): Promise<NotificationRow[]> {
  const { rows } = await client.query<NotificationRow>(
    `select n.id, n.template, n.created_at, n.read_at is not null as read,
            t.id as request_id, t.title as request_title,
            u.code as unit_code, u.name as unit_name
     from office.notifications n
     left join office.tasks t
       on n.record_type = 'task' and t.id = n.record_id and t.kind = 'request'
      and t.company_id = n.company_id and t.requester_user_id = n.recipient_user_id
     left join office.units u on n.template = 'request_returned' and u.code = t.unit_code
     where n.company_id = office.ctx_company_id()
       and n.recipient_user_id = office.ctx_user_id()
       and office.ctx_agent_code() is null
       and n.channel = 'panel'
       and (
         (n.template = 'passkeys_reset' and n.record_type = 'user'
          and n.record_id = n.recipient_user_id)
         or (n.template in ('request_returned', 'request_rejected', 'request_stopped')
             and t.id is not null and office.is_insider())
       )
       and (n.read_at is null or n.created_at > now() - make_interval(days => $1::int))
     order by n.created_at desc, n.id
     limit $2`,
    [options.keepDays, options.limit],
  );
  return rows;
}

/**
 * Marks notifications of the calling person read. An id that is not theirs, is of another company
 * or is read already changes nothing and says nothing; returns how many rows were marked. The
 * database lets only the API's role write the mark.
 */
export async function markNotificationsRead(
  client: Queryable,
  notificationIds: readonly string[],
): Promise<number> {
  const result = await client.query(
    `update office.notifications n set read_at = now()
     where n.id = any ($1::uuid[])
       and n.company_id = office.ctx_company_id()
       and n.recipient_user_id = office.ctx_user_id()
       and n.read_at is null`,
    [notificationIds],
  );
  return result.rowCount ?? 0;
}
