import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDay,
  formatFull,
  formatMessageTime,
  formatWhen,
  isOverdue,
  officeToday,
} from './dates.ts';

// 6 October 2026, 12:00 in Istanbul.
const NOW = Date.parse('2026-10-06T09:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatWhen', () => {
  it('goes from "şimdi" through minutes, hours and days to a date', () => {
    expect(formatWhen(ago(20_000), NOW)).toBe('şimdi');
    expect(formatWhen(ago(5 * MINUTE), NOW)).toBe('5 dk. önce');
    expect(formatWhen(ago(59 * MINUTE), NOW)).toBe('59 dk. önce');
    expect(formatWhen(ago(3 * HOUR), NOW)).toBe('3 sa. önce');
    expect(formatWhen(ago(DAY), NOW)).toBe('dün');
    expect(formatWhen(ago(47 * HOUR), NOW)).toBe('dün');
    // Counted from the second day on: not the word the language has for "the day before yesterday".
    expect(formatWhen(ago(2 * DAY), NOW)).toBe('2 gün önce');
    expect(formatWhen(ago(4 * DAY), NOW)).toBe('4 gün önce');
    expect(formatWhen(ago(6 * DAY), NOW)).toBe('6 gün önce');
    expect(formatWhen(ago(8 * DAY), NOW)).toBe('28 Eyl');
    expect(formatWhen('2025-07-31T09:00:00Z', NOW)).toBe('31 Tem 2025');
  });

  it('never needs more than eleven characters, so an 80 px column holds it', () => {
    const samples = [20_000, 59 * MINUTE, 23 * HOUR, DAY, 2 * DAY, 6 * DAY, 30 * DAY, 500 * DAY];
    for (const age of samples) {
      expect(formatWhen(ago(age), NOW).length, String(age)).toBeLessThanOrEqual(11);
    }
  });
});

describe('days', () => {
  it('today is the day of the office, whatever the clock of the browser says', () => {
    // 22:30 UTC on the 5th is already the 6th in Istanbul.
    expect(officeToday(Date.parse('2026-10-05T22:30:00Z'))).toBe('2026-10-06');
    expect(officeToday(Date.parse('2026-10-05T20:59:00Z'))).toBe('2026-10-05');
  });

  it('writes a day without moving it across a time zone', () => {
    expect(formatDay('2026-10-20', NOW)).toBe('20 Eki');
    expect(formatDay('2026-01-01', NOW)).toBe('1 Oca');
    expect(formatDay('2027-01-01', NOW)).toBe('1 Oca 2027');
  });

  it('a due day is late from the next day on', () => {
    expect(isOverdue('2026-10-05', NOW)).toBe(true);
    expect(isOverdue('2026-10-06', NOW)).toBe(false);
    expect(isOverdue('2026-10-07', NOW)).toBe(false);
  });
});

describe('message times', () => {
  it('shows the time today and the day before that', () => {
    const today = new Date(NOW);
    today.setHours(9, 5, 0, 0);
    expect(formatMessageTime(today.toISOString(), NOW)).toBe('09:05');
    const earlier = new Date(NOW - 3 * DAY);
    earlier.setHours(14, 32, 0, 0);
    expect(formatMessageTime(earlier.toISOString(), NOW)).toMatch(/^3 Eki 14:32$/);
    const lastYear = new Date(NOW - 400 * DAY);
    expect(formatMessageTime(lastYear.toISOString(), NOW)).toMatch(/2025 \d{2}:\d{2}$/);
  });

  it('writes the time of day alone', () => {
    const at = new Date(NOW);
    at.setHours(14, 32, 0, 0);
    expect(formatClock(at.toISOString())).toBe('14:32');
    at.setHours(9, 5, 0, 0);
    expect(formatClock(at.toISOString())).toBe('09:05');
  });

  it('writes the whole date for a title', () => {
    expect(formatFull('2026-10-06T09:00:00Z')).toMatch(/^6 Ekim 2026 \d{2}:00$/);
  });
});
