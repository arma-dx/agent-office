import { describe, expect, it } from 'vitest';
import { requestDetail, summaryOf } from '../../test/request-fixtures.ts';
import { textWidth } from '../../test/text-width.ts';
import {
  CAUSE_FOR_FOUNDER,
  CAUSE_NEXT,
  CAUSE_SENTENCE,
  WAITING_WORK_IF_ANY,
  dueText,
  rowSentence,
  stepText,
  waitingWorkSentence,
  type OpeningKind,
} from './labels.ts';

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

// 8 October decision 49: work that waited for a stopped agent or a closed AI permission starts
// again when the switch is opened. The sentences that said the opposite were reworded.
describe('the sentences decision 49 changed', () => {
  it('a stopped agent and a closed coordinator: opening starts the work again, and the way that does not wait is named', () => {
    expect(CAUSE_NEXT.agent_stopped).toBe(
      'Ajan Ofis görünümünden yeniden açıldığında bu iş kendiliğinden yeniden başlar. Beklemek istemiyorsanız "Yönlendirmeyi düzelt" ile işi açık bir ajana verebilirsiniz.',
    );
    expect(CAUSE_NEXT.coordinator_closed).toBe(
      'Koordinasyon merkezi yeniden açıldığında bu talebi kendiliğinden ele alır. Beklemek istemiyorsanız "Yönlendirmeyi düzelt" ile talebi bir birime ve ajana kendiniz verebilirsiniz.',
    );
  });

  it('çalışma başlamadı reads as a job the runner refused although the agent is open', () => {
    expect(CAUSE_SENTENCE.not_started).toBe(
      'Ajanın çalışması başlatılamadı: ajan açık olduğu hâlde çalıştırıcı işi başlatmadı (ajanın kartı okunamadı, iş verildikten sonra talep değişti ya da çalıştırıcı işi o an alamadı).',
    );
    // The way on is unchanged: a person gives the work to an agent again.
    expect(CAUSE_NEXT.not_started).toBe(
      '"Yönlendirmeyi düzelt" ile işi bir ajana yeniden verin; yeni bir çalışma başlar. İş gerekmiyorsa talebi kapatabilirsiniz.',
    );
  });

  it('a closed AI permission: the founder is told that opening it starts the waiting work', () => {
    expect(CAUSE_FOR_FOUNDER.ai_permission_closed).toBe(
      'İzni projenin sayfasından açabilirsiniz; passkey ister. İzin açılınca bekleyen iş kendiliğinden yeniden başlar. İş gerekmiyorsa talebi durdurabilirsiniz.',
    );
    // While it holds, the routing cannot be corrected: no way on is named for it.
    expect(CAUSE_NEXT.ai_permission_closed).toBeUndefined();
    expect(CAUSE_SENTENCE.ai_permission_interrupted).toBe(
      'Yapay zekâ izni kapatıldığı için ajanın çalışması durduruldu. İzin yeniden açık, ama iş yeniden başlamadı.',
    );
    expect(CAUSE_NEXT.ai_permission_interrupted).toBe(
      'Ajan kapalıysa Ofis görünümünden açıldığında iş kendiliğinden başlar. Ajan açıksa "Yönlendirmeyi düzelt" ile işi yeniden verin.',
    );
  });

  it('no sentence says any more that opening an agent starts nothing', () => {
    const all = [
      ...Object.values(CAUSE_SENTENCE),
      ...Object.values(CAUSE_NEXT),
      ...Object.values(CAUSE_FOR_FOUNDER),
    ];
    for (const sentence of all) {
      expect(sentence).not.toMatch(
        /kendiliğinden (yeniden )?başlatmaz|kendiliğinden başlamaz|yeniden ele almaz/,
      );
    }
  });
});

describe('the sentence of an opening: counting, none, a number, not counted', () => {
  const KINDS: OpeningKind[] = ['agent', 'project', 'customer'];

  it('says that the count is on its way, in the same words for the three openings', () => {
    for (const kind of KINDS) {
      expect(waitingWorkSentence(kind, 'counting')).toBe('Bekleyen talepler sayılıyor.');
    }
  });

  it('says that nothing starts when nothing waits', () => {
    expect(waitingWorkSentence('agent', 0)).toBe(
      'Bu ajanı bekleyen talep yok; açmak hiçbir çalışmayı başlatmaz.',
    );
    expect(waitingWorkSentence('project', 0)).toBe(
      'Bu projede bekleyen talep yok; izni açmak hiçbir çalışmayı başlatmaz.',
    );
    expect(waitingWorkSentence('customer', 0)).toBe(
      'Bu müşterinin projelerinde bekleyen talep yok; izni açmak hiçbir çalışmayı başlatmaz.',
    );
  });

  it('names the number twice: how many wait, and how many paid runs the opening starts', () => {
    expect(waitingWorkSentence('agent', 3)).toBe(
      'Bu ajanı 3 talep bekliyor. Ajanı açınca 3 talebin çalışması hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
    );
    expect(waitingWorkSentence('project', 1)).toBe(
      'Bu projede 1 talep bekliyor. İzni açınca 1 talebin çalışması hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
    );
    expect(waitingWorkSentence('customer', 12)).toBe(
      'Bu müşterinin projelerinde 12 talep bekliyor. İzni açınca 12 talebin çalışması hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
    );
  });

  it('says so when the count could not be read, and what may start', () => {
    expect(waitingWorkSentence('agent', 'unknown')).toBe(
      'Bekleyen talepler sayılamadı. Bu ajanı bekleyen talep varsa açınca hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
    );
    expect(waitingWorkSentence('project', 'unknown')).toBe(
      'Bekleyen talepler sayılamadı. Bu projede bekleyen talep varsa izni açınca hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
    );
    expect(waitingWorkSentence('customer', 'unknown')).toBe(
      'Bekleyen talepler sayılamadı. Bu müşterinin projelerinde bekleyen talep varsa izni açınca hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
    );
    // The confirmations that do not count yet say the same without the first sentence.
    for (const kind of KINDS) {
      expect(waitingWorkSentence(kind, 'unknown')).toBe(
        `Bekleyen talepler sayılamadı. ${WAITING_WORK_IF_ANY[kind]}`,
      );
    }
  });
});
