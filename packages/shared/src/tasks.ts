import { z } from 'zod';

/**
 * What a request (flow A, "talep") and a task between people (flow B, "görev") have in common:
 * both are rows of office.tasks and share its statuses. Everything else is kept apart: the
 * contracts of a request are in requests.ts; a task between people gets its own when it is built.
 */

/** The values the database holds (supabase/migrations: tasks.status); labels are the panel's. */
export const taskStatusSchema = z.enum([
  'open',
  'in_progress',
  'awaiting_approval',
  'awaiting_reply',
  'done',
  'cancelled',
]);
export type TaskStatus = z.output<typeof taskStatusSchema>;
export const TASK_STATUSES = taskStatusSchema.options;

/** Closed work: nobody is expected to do anything more with it. */
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];

export function isClosedTaskStatus(status: TaskStatus): boolean {
  return CLOSED_TASK_STATUSES.includes(status);
}

/** Days and times shown in the panel are read in the office's time zone. */
export const OFFICE_TIME_ZONE = 'Europe/Istanbul';

const officeDayParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: OFFICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The day of an instant in the office's time zone, as YYYY-MM-DD. A due day is such a day:
 * between midnight and 03:00 in Türkiye the UTC day is still the day before.
 */
export function officeDay(instant: Date | number): string {
  const parts = officeDayParts.formatToParts(instant);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A person named on a record. `name` is null when the person is no longer a member. */
export const taskPersonSchema = z.object({ userId: z.uuid(), name: z.string().nullable() });
export type TaskPerson = z.output<typeof taskPersonSchema>;
