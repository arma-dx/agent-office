import { describe, expect, it } from 'vitest';
import { PROJECT_REF, requestDetail, summaryOf } from '../../test/request-fixtures.ts';
import { textWidth } from '../../test/text-width.ts';
import {
  AI_CLOSED_FOR_OTHERS,
  CAUSE_FOR_FOUNDER,
  CAUSE_NEXT,
  CAUSE_SENTENCE,
  CAUSE_SHORT,
  CHANGES_HELD,
  OPEN_PROJECT,
  OPEN_REQUESTS_GO_ON,
  PROJECT_REQUESTS_GO_ON,
  REQUESTER_ABSENT,
  REQUESTER_ABSENT_CLOSED,
  RESULT_HELD,
  RESULT_HELD_FOR_FOUNDER,
  RESULT_HELD_FOR_OTHERS,
  WAITING_WORK_IF_ANY,
  acceptInPlace,
  answeredInPlace,
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
        false,
        NOW,
      ),
    ).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor (gecikti), sıra SOS-2, Son tarihi geçti: 5 Eki',
    );
    expect(rowSentence(summaryOf({ ...working, dueDate: '2026-10-20' }), false, NOW)).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor, sıra SOS-2, Son tarih: 20 Eki',
    );
    expect(rowSentence(summaryOf(working), false, NOW)).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor, sıra SOS-2',
    );
    for (const overdue of [true, false]) {
      expect(dueText({ dueDate: '2026-10-05', overdue }, NOW)).not.toMatch(/gecik/i);
    }
  });

  it('the row’s sentence names the project after the title, only where the row shows it', () => {
    const working = requestDetail({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      approval: null,
      project: PROJECT_REF,
      dueDate: '2026-10-20',
    });
    // The Talepler screen: the row shows the project's name.
    expect(rowSentence(summaryOf(working), true, NOW)).toBe(
      'LinkedIn için gönderi yaz, proje Lansman, Ajan çalışıyor, sıra SOS-2, Son tarih: 20 Eki',
    );
    // A project's own page: every row is of that project.
    expect(rowSentence(summaryOf(working), false, NOW)).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor, sıra SOS-2, Son tarih: 20 Eki',
    );
    expect(rowSentence(summaryOf(working))).not.toMatch(/proje/);
    // A request without a project names none, wherever it is listed.
    expect(rowSentence(summaryOf({ ...working, project: null, dueDate: null }), true, NOW)).toBe(
      'LinkedIn için gönderi yaz, Ajan çalışıyor, sıra SOS-2',
    );
  });

  it('leaves the title of a row room next to a day that has passed, at 1024 px', () => {
    // Below 1280 px only "Son tarihi geçti: ..." is shown after the title (components/requests/
    // request-list.tsx; the project's name is hidden there too). The row at 1024 px: 1024 less the sidebar (240), the page's padding (48) and
    // the row's own (16) is 720 px; the status icon with its gap takes 24, the stage and turn
    // columns with their gaps 288 (w-44, w-24), the gaps around the mark 16. The mark is 12 px
    // text at weight 500, drawn a little wider than the weight the table of widths holds: 5 % is
    // added. What is left is the title's, which cuts itself: it must stay readable.
    const ROW = 720 - 24 - 288 - 16;
    const widest = dueText({ dueDate: '2025-12-30', overdue: true }, NOW);
    if (widest === null) throw new Error('No due text');
    expect(ROW - textWidth(widest, 12) * 1.05).toBeGreaterThan(200);
  });

  it('leaves the title of a row room next to the name of its project, at 1280 px and at 1440 px', () => {
    // From 1280 px the row shows every column (components/requests/request-list.tsx): the content
    // is the window less the sidebar (240), the page's padding (48) and the row's own (16); the
    // status icon with its gap takes 24, the unit, stage, turn and time columns with their gaps
    // 552 (w-14, w-64, w-32, w-20), the gaps around the marks 16. The project's name is cut at
    // 160 px (max-w-40).
    const row = (window: number) => window - 240 - 48 - 16 - 24 - 552 - 16;
    const PROJECT = 160;
    // Without a due day the name shows from 1280 px.
    expect(row(1280) - PROJECT).toBeGreaterThan(200);
    // With a due day both marks and the gap between them would leave the title next to nothing
    // at 1280 px, so the name waits for 1440 px there.
    const widest = dueText({ dueDate: '2025-12-30', overdue: true }, NOW);
    if (widest === null) throw new Error('No due text');
    const due = textWidth(widest, 12) * 1.05;
    expect(row(1280) - PROJECT - 8 - due).toBeLessThan(100);
    expect(row(1440) - PROJECT - 8 - due).toBeGreaterThan(200);
  });
});

// Rule 12 while a request is under way (8 October decisions 46 and 47): a closed AI permission
// holds the request and its result. Every sentence about it is fixed and names no owner of the
// permission it cannot know (the project's or its customer's).
describe('the held request names the permission, and the reworded sentences', () => {
  it('names the cause in a few words and in a sentence', () => {
    expect(CAUSE_SHORT.ai_permission_closed).toBe('yapay zekâ izni kapalı');
    expect(CAUSE_SHORT.ai_permission_interrupted).toBe('izin kapanınca durdu');
    expect(CAUSE_SENTENCE.ai_permission_closed).toBe(
      'Bu talebin projesinde ajanlar şu an çalışamaz: projenin ya da müşterisinin yapay zekâ izni kapalı. Süren çalışma varsa durduruldu.',
    );
    expect(AI_CLOSED_FOR_OTHERS).toBe('Talep kayıtlı. Yapay zekâ iznini yalnızca kurucu açar.');
    expect(OPEN_PROJECT).toBe('Projeyi aç');
  });

  it('says of a held result what cannot be done and what still can', () => {
    expect(RESULT_HELD).toBe(
      'Bu projede ajanlar şu an çalışamaz: projenin ya da müşterisinin yapay zekâ izni kapalı. İzin açılana kadar sonuç onaylanamaz ve düzeltme istenemez; sonucu reddedebilirsiniz.',
    );
    expect(RESULT_HELD_FOR_FOUNDER).toBe('İzni projenin sayfasından açabilirsiniz.');
    expect(RESULT_HELD_FOR_OTHERS).toBe(
      'Bu projede ajanlar şu an çalışamaz; izin açılana kadar sonuç onaylanamaz. Yapay zekâ iznini yalnızca kurucu açar.',
    );
    expect(CHANGES_HELD).toBe(
      'Bu projede ajanlar şu an çalışamaz: izin açılana kadar düzeltme istenemez. Sonuç istediğiniz gibiyse onaylayabilirsiniz.',
    );
  });

  it('a card that cannot run names its third reason: it is not open to a request inside a project', () => {
    expect(CAUSE_FOR_FOUNDER.card_not_runnable).toBe(
      'Kart taslak durumunda; deneme durumunda ve talep kurucuya ait değil; ya da kart, proje içindeki talepte çalışmaya açık değil (project_context alanı). Kart depoda değiştirilir.',
    );
  });
});

// 8 October decision 45: the request of a requester who can no longer read it goes on in the
// founder's name, and the founder answers its result in their place.
describe('the sentences of a request that goes on without its requester', () => {
  it('says so on the request, in the open and in the closed form', () => {
    expect(REQUESTER_ABSENT).toBe(
      'Talep sahibi bu talebi artık göremiyor. Talep sürer: ajan kurucunun adına çalışır, sonucu da talep sahibinin yerine kurucu onaylar.',
    );
    expect(REQUESTER_ABSENT_CLOSED).toBe('Talep sahibi bu talebi artık göremiyor.');
  });

  it('tells the founder in whose place they decide, and names nobody when the name is gone', () => {
    expect(acceptInPlace({ name: 'Ayşe Yılmaz' })).toBe(
      'Bu sonuca talep sahibi Ayşe Yılmaz yerine siz karar veriyorsunuz: talep sahibi talebi artık göremiyor.',
    );
    // A requester removed from the company has no name the founder may read.
    expect(acceptInPlace({ name: null })).toBe(
      'Bu sonuca talep sahibinin yerine siz karar veriyorsunuz: talep sahibi talebi artık göremiyor.',
    );
  });

  it('the journey names who answered in the requester’s place', () => {
    expect(answeredInPlace('approved', { name: 'Ömer Kadıoğlu' })).toBe(
      'Ömer Kadıoğlu, talep sahibinin yerine onayladı.',
    );
    expect(answeredInPlace('changes_requested', { name: 'Ömer Kadıoğlu' })).toBe(
      'Ömer Kadıoğlu, talep sahibinin yerine düzeltme istedi.',
    );
    expect(answeredInPlace('approved', { name: null })).toBe(
      'Eski üye, talep sahibinin yerine onayladı.',
    );
  });

  it('whoever takes a person’s requests from them is told that the requests go on', () => {
    expect(OPEN_REQUESTS_GO_ON).toBe(
      ' Açık talepleri sürer: ajan kurucunun adına çalışır, sonucu kurucu onaylar.',
    );
    expect(PROJECT_REQUESTS_GO_ON).toBe(
      ' Bu projede açık talebi varsa talep sürer: ajan kurucunun adına çalışır, sonucu kurucu onaylar.',
    );
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
