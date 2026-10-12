import { z } from 'zod';
import { unitCodeSchema } from './cards.ts';
import { requestSummarySchema } from './requests.ts';

/**
 * The Bugün screen (8 October decisions 7 and 8): what is expected of the reader in the selected
 * company, and the notifications of the reader. The API builds every answer with these schemas and
 * the panel validates every answer.
 *
 * An expected item is a request summary and nothing more: the stage says what is expected
 * (unit_approval: the reader may decide the result; requester_approval: the reader is the
 * requester; awaiting_reply: the reader is the one who answers the agent's question;
 * fell_to_person: it is the reader's turn). A notification carries a template code and
 * ids; its sentence is the panel's, never a text from the database.
 */

/**
 * At most this many open requests are looked at for the list, and so for the Bugün number of the
 * sidebar, which is its length. The Onaylar number is not cut by it.
 */
export const TODAY_REQUEST_LIMIT = 200;
/** At most this many notifications are listed, the newest first. */
export const NOTIFICATION_LIST_LIMIT = 100;
/** A read notification stays listed for this many days; an unread one until it is read. */
export const NOTIFICATION_KEEP_DAYS = 30;

/**
 * The templates the flow of a request writes (supabase/migrations: request closing
 * notifications). Reserved in the database: no request of the API and no agent run writes them.
 */
export const REQUEST_NOTIFICATION_TEMPLATES = [
  'request_returned',
  'request_rejected',
  'request_stopped',
] as const;

/** Every template the panel has a sentence for. */
export const notificationTemplateSchema = z.enum([
  ...REQUEST_NOTIFICATION_TEMPLATES,
  'passkeys_reset',
]);
export type NotificationTemplate = z.output<typeof notificationTemplateSchema>;

const instantSchema = z.iso.datetime({ offset: true });
const requestRefSchema = z.object({ id: z.uuid(), title: z.string() });
const notificationBase = { id: z.uuid(), createdAt: instantSchema, read: z.boolean() };

export const todayNotificationSchema = z.discriminatedUnion('template', [
  z.object({
    ...notificationBase,
    template: z.literal('request_returned'),
    request: requestRefSchema,
    // The unit that had no open agent for the request; null when the unit is gone.
    unit: z.object({ code: unitCodeSchema, name: z.string() }).nullable(),
  }),
  z.object({
    ...notificationBase,
    template: z.literal('request_rejected'),
    request: requestRefSchema,
  }),
  z.object({
    ...notificationBase,
    template: z.literal('request_stopped'),
    request: requestRefSchema,
  }),
  z.object({ ...notificationBase, template: z.literal('passkeys_reset') }),
]);
export type TodayNotification = z.output<typeof todayNotificationSchema>;

/** GET /api/today. */
export const todaySchema = z.object({
  // The one that has not moved for longest first.
  expected: z.array(requestSummarySchema),
  // More than TODAY_REQUEST_LIMIT open requests could expect something of the reader.
  expectedTruncated: z.boolean(),
  // The newest first.
  notifications: z.array(todayNotificationSchema),
  notificationsTruncated: z.boolean(),
});
export type Today = z.output<typeof todaySchema>;

/**
 * GET /api/today/counts: the two numbers of the sidebar. `today` is the length of `expected`, cut
 * like it at TODAY_REQUEST_LIMIT open requests. `approvals` is the number of decisions the Onaylar
 * screen lists (a result the reader may decide, a result of the reader's own request to accept),
 * counted without that limit. While the list is not cut, `approvals` is the part of `today` that
 * is a decision; once it is cut, `approvals` can be the greater number. Notifications are never
 * counted.
 */
export const sidebarCountsSchema = z.object({
  today: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
});
export type SidebarCounts = z.output<typeof sidebarCountsSchema>;

/** POST /api/notifications/read: the notifications the person saw and marks read. */
export const markNotificationsReadSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(NOTIFICATION_LIST_LIMIT),
});
export type MarkNotificationsRead = z.input<typeof markNotificationsReadSchema>;
