import { officeDay } from '@agent-office/shared';

/**
 * Times and days as the task screens write them. Days (a due date) are days of the office's time
 * zone, whatever the browser's own zone is; instants (when something happened) are shown in the
 * browser's zone, as everywhere else in the panel.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'always', style: 'short' });
// Only for one day ago ("dün"): the same format writes two days ago as "evvelsi gün", which reads
// oddly between "dün" and "3 gün önce".
const relativeWord = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto', style: 'short' });
const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const clock = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const full = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' });
// A day has no time zone of its own: it is formatted as that day in UTC.
const dayText = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayTextYear = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * How long ago, short enough for an 80 px column: "şimdi", "5 dk. önce", "3 sa. önce", "dün",
 * "2 gün önce" to "6 gün önce", then the date ("28 Eyl", with the year when it is not this year).
 */
export function formatWhen(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  const age = now - then;
  if (age < MINUTE) return 'şimdi';
  if (age < HOUR) return relative.format(-Math.floor(age / MINUTE), 'minute');
  if (age < DAY) return relative.format(-Math.floor(age / HOUR), 'hour');
  if (age < 2 * DAY) return relativeWord.format(-1, 'day');
  if (age < 7 * DAY) return relative.format(-Math.floor(age / DAY), 'day');
  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? dayMonth : dayMonthYear).format(then);
}

/** The time of day alone, for something read a moment ago: "14:32". */
export function formatClock(iso: string): string {
  return clock.format(Date.parse(iso));
}

/** The whole date and time, for a title attribute: "6 Ekim 2026 14:32". */
export function formatFull(iso: string): string {
  return full.format(Date.parse(iso));
}

/**
 * When a message was written: the time today ("14:32"), the day and the time before that
 * ("5 Eki 14:32", with the year when it is not this year). A message always shows its day.
 */
export function formatMessageTime(iso: string, now: number = Date.now()): string {
  const then = new Date(Date.parse(iso));
  const today = new Date(now);
  const time = clock.format(then);
  if (then.toDateString() === today.toDateString()) return time;
  const sameYear = then.getFullYear() === today.getFullYear();
  return `${(sameYear ? dayMonth : dayMonthYear).format(then)} ${time}`;
}

/**
 * Today in the office's time zone, as YYYY-MM-DD: the same function the API and the runner read
 * the day with.
 */
export function officeToday(now: number = Date.now()): string {
  return officeDay(now);
}

/** A day (YYYY-MM-DD) as text: "20 Eki", with the year when it is not this year. */
export function formatDay(day: string, now: number = Date.now()): string {
  const date = new Date(`${day}T00:00:00Z`);
  const sameYear = day.slice(0, 4) === officeToday(now).slice(0, 4);
  return (sameYear ? dayText : dayTextYear).format(date);
}

/** True when the due day has passed in the office's time zone. */
export function isOverdue(day: string, now: number = Date.now()): boolean {
  return day < officeToday(now);
}
