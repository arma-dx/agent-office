import { describe, expect, it } from 'vitest';
import { requestDetail, summaryOf } from '../../test/request-fixtures.ts';
import { textWidth } from '../../test/text-width.ts';
import { dueText, rowSentence, stepText } from './labels.ts';

describe('the text of a step of a run', () => {
  it('does not claim a routing: the coordinator calls its tool also when no unit fits', () => {
    // The run's summary says what became of the request; the step only says the tool was called.
    expect(stepText({ tool: 'route_task', status: 'succeeded' })).toBe(
      'Yönlendirme kararını bildirdi',
    );
    expect(stepText({ tool: 'route_task', status: 'failed' })).toBe(
      'Yönlendirme kararını bildirdi (olmadı)',
    );
  });

  it('keeps the verb of the other tools and names an unknown tool', () => {
    expect(stepText({ tool: 'submit_for_approval', status: 'succeeded' })).toBe('Onaya sundu');
    expect(stepText({ tool: 'send_email', status: 'blocked' })).toBe(
      'Araç çağrısı: send_email (engellendi)',
    );
  });
});

describe('the due day of a request in words', () => {
  // 9 October 2026, 12:00 in Istanbul.
  const NOW = Date.parse('2026-10-09T09:00:00Z');

  it('writes the due day and says in its own words that it has passed', () => {
    expect(dueText({ dueDate: null, overdue: false }, NOW)).toBeNull();
    expect(dueText({ dueDate: '2026-10-20', overdue: false }, NOW)).toBe('Son tarih: 20 Eki');
    expect(dueText({ dueDate: '2026-10-05', overdue: true }, NOW)).toBe('Son tarihi geçti: 5 Eki');
    // The year is written when it is not this year.
    expect(dueText({ dueDate: '2027-01-15', overdue: false }, NOW)).toBe('Son tarih: 15 Oca 2027');
    expect(dueText({ dueDate: '2025-12-30', overdue: true }, NOW)).toBe(
      'Son tarihi geçti: 30 Ara 2025',
    );
    // The API decides whether the day has passed (its clock, like `delayed`); a closed request
    // whose day lies behind is not said to be late.
    expect(dueText({ dueDate: '2026-10-05', overdue: false }, NOW)).toBe('Son tarih: 5 Eki');
  });

  it('the row’s sentence names the due day after the stage and the turn, and never calls it "gecikti"', () => {
    const working = requestDetail({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      approval: null,
    });
    // Two facts with two words: the run takes long ("gecikti"), the due day has passed.
    expect(
      rowSentence(
        summaryOf({ ...working, delayed: true, dueDate: '2026-10-05', overdue: true }),
        NOW,
      ),
    ).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor (gecikti), sıra SOS-2, Son tarihi geçti: 5 Eki',
    );
    expect(rowSentence(summaryOf({ ...working, dueDate: '2026-10-20' }), NOW)).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor, sıra SOS-2, Son tarih: 20 Eki',
    );
    expect(rowSentence(summaryOf(working), NOW)).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor, sıra SOS-2',
    );
    for (const overdue of [true, false]) {
      expect(dueText({ dueDate: '2026-10-05', overdue }, NOW)).not.toMatch(/gecik/i);
    }
  });

  it('leaves the title of a row room next to a day that has passed, at 1024 px', () => {
    // Below 1280 px only "Son tarihi geçti: ..." is shown after the title (routes/.../
    // requests.tsx). The row at 1024 px: 1024 less the sidebar (240), the page's padding (48) and
    // the row's own (16) is 720 px; the status icon with its gap takes 24, the stage and turn
    // columns with their gaps 288 (w-44, w-24), the gaps around the mark 16. The mark is 12 px
    // text at weight 500, drawn a little wider than the weight the table of widths holds: 5 % is
    // added. What is left is the title's, which cuts itself: it must stay readable.
    const ROW = 720 - 24 - 288 - 16;
    const widest = dueText({ dueDate: '2025-12-30', overdue: true }, NOW);
    if (widest === null) throw new Error('No due text');
    expect(ROW - textWidth(widest, 12) * 1.05).toBeGreaterThan(200);
  });
});
