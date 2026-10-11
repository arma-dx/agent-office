import type {
  RejectionReason,
  RequestCause,
  RequestDetail,
  RequestIntakeReason,
  RequestStage,
  RequestSummary,
  RequestTurn,
  TaskPerson,
} from '@agent-office/shared';
import { formatDay } from '../dates.ts';

/**
 * The words of flow (A). Every sentence a person reads about a request is made here from codes
 * and names of records; none is written by a model. Text an agent wrote is shown only to a person
 * who may decide the work (the API gives it to nobody else): the coordinator's reason, the words
 * of a run that ended without a result and, inside the approval card, the agent's summary,
 * reasoning and risk note, each under a label that says whose words it is.
 */

export const FORMER_MEMBER = 'Eski üye';

export function personName(person: TaskPerson | { name: string | null }): string {
  return person.name ?? FORMER_MEMBER;
}

export const STAGE_LABEL: Record<RequestStage, string> = {
  routing: 'Yönlendiriliyor',
  working: 'Ajan çalışıyor',
  revising: 'Ajan düzeltiyor',
  unit_approval: 'Birim onayında',
  requester_approval: 'Talep sahibinin onayında',
  fell_to_person: 'İnsana düştü',
  done: 'Tamamlandı',
  cancelled: 'İptal edildi',
};

/** The stage in the second person, for the one whose turn it is. */
const STAGE_FOR_ME: Partial<Record<RequestStage, string>> = {
  unit_approval: 'Onayınız bekleniyor',
  requester_approval: 'Sonucu onaylamanız bekleniyor',
  fell_to_person: 'Sizden bekleniyor',
};

export const CAUSE_SHORT: Record<RequestCause, string> = {
  coordinator_closed: 'koordinasyon merkezi kapalı',
  no_routing: 'yönlendirilemedi',
  agent_stopped: 'ajan durduruldu',
  not_started: 'çalışma başlamadı',
  no_submission: 'ajan sonuç sunmadı',
  run_failed: 'çalışma tamamlanamadı',
  run_interrupted: 'çalışma yarıda kesildi',
  limit_reached: 'sınıra takıldı',
  model_refused: 'model yanıt vermedi',
  model_unavailable: 'model bağlantısı yok',
  model_billing: 'model hesabında ödeme sorunu',
  model_not_available: 'model bu hesapta yok',
  card_not_runnable: 'ajan kartı çalışmaya açık değil',
  second_change_request: 'ikinci düzeltme isteği',
  ai_permission_closed: 'yapay zekâ izni kapalı',
  ai_permission_interrupted: 'izin kapanınca durdu',
  spending_limit_reached: 'harcama sınırı doldu',
  spending_limit_interrupted: 'sınır dolunca durdu',
  returned_no_agent: 'birimde açık ajan yok',
  cancelled_by_requester: 'talep sahibi iptal etti',
  stopped: 'durduruldu',
  closed_after_delivery: 'sonuç iletildi, talep sahibi yanıtlamadı',
  rejected: 'sonuç reddedildi',
};

/**
 * One sentence for the notice of a request that fell to a person. The closing notice of a
 * cancelled request builds its own sentence with the names of the record (who closed it, which
 * unit had no agent); the entries of those causes are what is said when a name is missing.
 */
export const CAUSE_SENTENCE: Record<RequestCause, string> = {
  coordinator_closed: 'Koordinasyon merkezi bu şirkette açık olmadığı için talep yönlendirilemedi.',
  no_routing: 'Koordinasyon merkezi bu talebi bir birime yönlendiremedi.',
  agent_stopped: 'Ajan durdurulduğu için iş yarıda kaldı.',
  // Read only while the agent is open and after no restart made the missed start good: the job
  // was refused for a reason the switch does not explain.
  not_started:
    'Ajanın çalışması başlatılamadı: ajan açık olduğu hâlde çalıştırıcı işi başlatmadı (ajanın kartı okunamadı, iş verildikten sonra talep değişti, projenin harcama sınırı o an doluydu ya da çalıştırıcı işi o an alamadı).',
  no_submission: 'Ajan sonucu onaya sunmadan çalışmasını bitirdi.',
  run_failed: 'Ajanın çalışması bir hata nedeniyle tamamlanamadı.',
  run_interrupted: 'Talep değiştiği için ajanın çalışması yarıda kesildi.',
  limit_reached: 'Ajan çalışma sınırına takıldı.',
  model_refused: 'Model bu isteği yanıtlamadı.',
  model_unavailable: 'Ajanlar şu an çalışamıyor: model hizmetine bağlanılamadı.',
  model_billing: 'Ajanlar şu an çalışamıyor: model hesabında ödeme sorunu var.',
  model_not_available: 'Ajanın kartında yazan model kullanılamıyor.',
  card_not_runnable: 'Bu ajanın kartı bu talep için çalışmaya açık değil.',
  second_change_request: 'İkinci düzeltme isteğinden sonra iş ajana dönmedi.',
  // Rule 12 while a request is under way: the project's AI permission, or its customer's.
  ai_permission_closed:
    'Bu talebin projesinde ajanlar şu an çalışamaz: projenin ya da müşterisinin yapay zekâ izni kapalı. Süren çalışma varsa durduruldu.',
  // The permission may have been the customer's, so the sentence names no owner.
  ai_permission_interrupted:
    'Yapay zekâ izni kapatıldığı için ajanın çalışması durduruldu. İzin yeniden açık, ama iş yeniden başlamadı.',
  // 8 October decision 17: the AI spending limit of the request's project.
  spending_limit_reached:
    'Bu talebin projesinde yapay zekâ harcama sınırı doldu. Ajanlar bu projede yeni çalışma başlatmaz; süren çalışma bir sonraki adımında durur.',
  spending_limit_interrupted:
    'Projenin yapay zekâ harcama sınırı dolduğu için ajanın çalışması durduruldu. Sınır artık dolu değil, ama iş kendiliğinden yeniden başlamadı.',
  returned_no_agent: 'Talep geri çevrildi: birimde bu işi alabilecek açık ajan yok.',
  cancelled_by_requester: 'Talep sahibi talebi iptal etti.',
  stopped: 'İş durduruldu.',
  closed_after_delivery: 'Sonuç onaylanıp iletildi; talep sahibi yanıtlamadan talep kapatıldı.',
  rejected: 'Birimin onaylayıcısı sonucu reddetti.',
};

/**
 * Why a request was returned to its requester (8 October decision 2), with the name of the unit
 * the coordinator chose: a fixed sentence, never the coordinator's own reason. And what follows
 * from it: the request is closed and is not opened again.
 */
export function returnedSentence(unitName: string | null): string {
  return unitName === null
    ? CAUSE_SENTENCE.returned_no_agent
    : `Talep geri çevrildi: ${unitName} biriminde bu işi alabilecek açık ajan yok.`;
}

export const RETURNED_NEXT =
  'Talep kapandı; bu iş için bir ajan açıldığında yeni bir talep gönderebilirsiniz.';

/**
 * What the person who can act is told to do (the founder, the approver of the request): every way
 * an open request stops has a way on, "Yönlendirmeyi düzelt", which gives the work to an agent
 * again and starts a new run. Two ways stop by a switch (a stopped agent, a closed coordinator):
 * opening the switch starts the work again (8 October decision 49), and the sentence says so.
 * Every other way on is "Yönlendirmeyi düzelt". A closed request (returned, cancelled, stopped,
 * rejected) has no way on and no entry. A request held by a closed AI permission has none either,
 * and neither has one held by a reached spending limit: while they hold, the routing cannot be
 * corrected.
 */
export const CAUSE_NEXT: Partial<Record<RequestCause, string>> = {
  coordinator_closed:
    'Koordinasyon merkezi yeniden açıldığında bu talebi kendiliğinden ele alır. Beklemek istemiyorsanız "Yönlendirmeyi düzelt" ile talebi bir birime ve ajana kendiniz verebilirsiniz.',
  no_routing: '"Yönlendirmeyi düzelt" ile talebi bir birime ve ajana kendiniz verebilirsiniz.',
  agent_stopped:
    'Ajan Ofis görünümünden yeniden açıldığında bu iş kendiliğinden yeniden başlar. Beklemek istemiyorsanız "Yönlendirmeyi düzelt" ile işi açık bir ajana verebilirsiniz.',
  // Also for a request the coordinator never routed: the person makes the first routing.
  not_started:
    '"Yönlendirmeyi düzelt" ile işi bir ajana yeniden verin; yeni bir çalışma başlar. İş gerekmiyorsa talebi kapatabilirsiniz.',
  no_submission:
    '"Yönlendirmeyi düzelt" ile işi aynı ajana yeniden verebilir (yeni bir çalışma başlar) ya da talebi kapatabilirsiniz.',
  run_failed:
    '"Yönlendirmeyi düzelt" ile işi aynı ajana yeniden verebilir (yeni bir çalışma başlar) ya da talebi kapatabilirsiniz.',
  run_interrupted:
    '"Yönlendirmeyi düzelt" ile işi aynı ajana yeniden verebilir (yeni bir çalışma başlar) ya da talebi kapatabilirsiniz.',
  limit_reached:
    '"Yönlendirmeyi düzelt" ile işi aynı ajana yeniden verebilir (yeni bir çalışma başlar) ya da talebi kapatabilirsiniz.',
  model_refused:
    'Talep metni modelin yanıtlamadığı bir içerik taşıyor olabilir. İşi "Yönlendirmeyi düzelt" ile yeniden verebilir ya da talebi kapatabilirsiniz.',
  second_change_request:
    'İş ajana kendiliğinden dönmez. "Yönlendirmeyi düzelt" ile bir açıklama yazarak yeniden verebilir ya da talebi kapatabilirsiniz.',
  // The permission is open again and the work did not start again: its agent was stopped at that
  // moment, or the permission was opened outside the panel.
  ai_permission_interrupted:
    'Ajan kapalıysa Ofis görünümünden açıldığında iş kendiliğinden başlar. Ajan açıksa "Yönlendirmeyi düzelt" ile işi yeniden verin.',
  // The limit is not reached any more and the work did not start again: the limit was changed
  // outside the panel, or the step's agent was stopped when it was raised.
  spending_limit_interrupted:
    '"Yönlendirmeyi düzelt" ile işi bir ajana yeniden verin; yeni bir çalışma başlar. İş gerekmiyorsa talebi kapatabilirsiniz.',
};

/** What only the founder is told, because only the founder can remove the cause. */
export const CAUSE_FOR_FOUNDER: Partial<Record<RequestCause, string>> = {
  coordinator_closed: 'Koordinasyon merkezi (KOR-1) Ofis görünümünden açılır.',
  model_unavailable:
    'Anthropic API anahtarı tanımlı değil ya da geçersiz. Anahtar .env dosyasına eklenip çalıştırıcı yeniden başlatıldıktan sonra "Yönlendirmeyi düzelt" ile işi yeniden verin.',
  model_billing:
    'Anthropic hesabında bakiye ya da ödeme yöntemi sorunu var. Konsolda düzelttikten sonra "Yönlendirmeyi düzelt" ile işi yeniden verin.',
  model_not_available:
    'Kartın yazdığı model bu Anthropic hesabında kullanılamıyor. Hesabın model erişimini ve agents/models.yaml dosyasını kontrol edin.',
  card_not_runnable:
    'Kart taslak durumunda; deneme durumunda ve talep kurucuya ait değil; ya da kart, proje içindeki talepte çalışmaya açık değil (project_context alanı). Kart depoda değiştirilir.',
  ai_permission_closed:
    'İzni projenin sayfasından açabilirsiniz; passkey ister. İzin açılınca bekleyen iş kendiliğinden yeniden başlar. İş gerekmiyorsa talebi durdurabilirsiniz.',
  // 11 October decision 1: raising the limit or taking it away starts the held work again. The
  // sentence promises only what a raise does: it restarts a run that was stopped and a start
  // that was refused, not a request whose run had ended by itself before the limit filled.
  spending_limit_reached:
    'Sınırı projenin sayfasındaki "Çalışmalar" sekmesinden yükseltebilirsiniz; passkey ister. Sınır yükselince yarıda durdurulan ya da başlatılamayan iş kendiliğinden yeniden başlar. Çalışması durdurulmadan bitmiş talep başlamaz; kendi nedeniyle insana düşer. İş gerekmiyorsa talebi durdurabilirsiniz.',
};

/**
 * The causes whose notice shows no words of the last run: that run is not why the request waits,
 * the permission or the limit is. The journey keeps those words for whoever may read them.
 */
export const CAUSES_WITHOUT_RUN_WORDS: readonly RequestCause[] = [
  'ai_permission_closed',
  'spending_limit_reached',
];

/**
 * A request held by a closed AI permission, for a reader who cannot open it: every reader of the
 * project's requests already reads "Ajanlar çalışamaz" on the project's page.
 */
export const AI_CLOSED_FOR_OTHERS = 'Talep kayıtlı. Yapay zekâ iznini yalnızca kurucu açar.';

/**
 * A request held by a reached AI spending limit, for a reader who cannot raise it. Never an
 * amount: the members learn that the limit is reached and nothing more (docs/SONRA.md P3-v).
 */
export const LIMIT_FOR_OTHERS = 'Talep kayıtlı. Harcama sınırını yalnızca kurucu yükseltir.';

/**
 * A result that waits while the AI spending limit of its project is reached (decision 17): unlike
 * a closed AI permission the limit does not hold the result, which is approved, rejected and
 * accepted as always; only what calls for a new run is held. Said in the approval card, and in
 * the acceptance card in the requester's words.
 */
export const CHANGES_HELD_BY_LIMIT =
  'Bu projenin yapay zekâ harcama sınırı doldu: sınır yükseltilene kadar düzeltme istenemez. Sonucu onaylayabilir ya da reddedebilirsiniz.';
export const CHANGES_HELD_BY_LIMIT_FOR_REQUESTER =
  'Bu projenin yapay zekâ harcama sınırı doldu: sınır yükseltilene kadar düzeltme istenemez. Sonuç istediğiniz gibiyse onaylayabilirsiniz.';

/** The link from a held request or a held result to the page where the permission is opened. */
export const OPEN_PROJECT = 'Projeyi aç';

/**
 * A result that waits while agents may not work in its project (rule 12, 8 October decision 46):
 * it is read, can be rejected and the request can be stopped, but it is not approved and no change
 * is asked for until the permission is open again. Said in the approval card, to who may decide.
 */
export const RESULT_HELD =
  'Bu projede ajanlar şu an çalışamaz: projenin ya da müşterisinin yapay zekâ izni kapalı. İzin açılana kadar sonuç onaylanamaz ve düzeltme istenemez; sonucu reddedebilirsiniz.';
export const RESULT_HELD_FOR_FOUNDER = 'İzni projenin sayfasından açabilirsiniz.';
/** The same hold on the request's page, for a reader who cannot decide the result. */
export const RESULT_HELD_FOR_OTHERS =
  'Bu projede ajanlar şu an çalışamaz; izin açılana kadar sonuç onaylanamaz. Yapay zekâ iznini yalnızca kurucu açar.';
/** The acceptance card: "not what I asked for" calls for a run; accepting the result does not. */
export const CHANGES_HELD =
  'Bu projede ajanlar şu an çalışamaz: izin açılana kadar düzeltme istenemez. Sonuç istediğiniz gibiyse onaylayabilirsiniz.';

/**
 * A request whose requester can no longer read it (taken out of its project, made an external
 * person, removed from the company, deactivated) goes on: the agent works in the founder's name
 * and the founder gives the requester's approval in their place (8 October decision 45). The
 * request stays the requester's: every page and list keeps naming who asked.
 */
export const REQUESTER_ABSENT =
  'Talep sahibi bu talebi artık göremiyor. Talep sürer: ajan kurucunun adına çalışır, sonucu da talep sahibinin yerine kurucu onaylar.';
/** The same fact on a request that is done or cancelled: nothing goes on any more. */
export const REQUESTER_ABSENT_CLOSED = 'Talep sahibi bu talebi artık göremiyor.';

/**
 * Above the question of the acceptance card, for the founder who answers in the requester's
 * place. "Karar veriyorsunuz": the card offers both answers. A requester who left the company has
 * no name the founder can read any more; the sentence then names nobody.
 */
export function acceptInPlace(requester: { name: string | null }): string {
  const whom =
    requester.name === null ? 'talep sahibinin yerine' : `talep sahibi ${requester.name} yerine`;
  return `Bu sonuca ${whom} siz karar veriyorsunuz: talep sahibi talebi artık göremiyor.`;
}

/**
 * The journey's line for a requester's approval that somebody else gave: who answered, and that
 * it was in the requester's place. Never "the requester approved".
 */
export function answeredInPlace(
  status: 'approved' | 'changes_requested',
  by: { name: string | null },
): string {
  return `${personName(by)}, talep sahibinin yerine ${
    status === 'approved' ? 'onayladı' : 'düzeltme istedi'
  }.`;
}

/**
 * Appended to the confirmation of an act that takes a person's requests from them, so that
 * whoever does it knows that the requests do not stop (decision 45). The first for the two acts
 * of the Kullanıcılar screen (remove from the company, make an external person), the second for
 * taking a member off one project. Both start with a space: they follow another sentence.
 */
export const OPEN_REQUESTS_GO_ON =
  ' Açık talepleri sürer: ajan kurucunun adına çalışır, sonucu kurucu onaylar.';
export const PROJECT_REQUESTS_GO_ON =
  ' Bu projede açık talebi varsa talep sürer: ajan kurucunun adına çalışır, sonucu kurucu onaylar.';

/** The three switches whose opening starts waiting work again (8 October decision 49). */
export type OpeningKind = 'agent' | 'project' | 'customer';

/** Where the waiting requests of an opening are, as the sentence starts. */
const WAITING_WHERE: Record<OpeningKind, string> = {
  agent: 'Bu ajanı',
  project: 'Bu projede',
  customer: 'Bu müşterinin projelerinde',
};

/**
 * What an opening may start, without a number: the second half of the sentence for a count that
 * could not be read. Every restarted request is a paid run, and the confirmation says so before
 * the founder confirms.
 */
export const WAITING_WORK_IF_ANY: Record<OpeningKind, string> = {
  agent:
    'Bu ajanı bekleyen talep varsa açınca hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
  project:
    'Bu projede bekleyen talep varsa izni açınca hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
  customer:
    'Bu müşterinin projelerinde bekleyen talep varsa izni açınca hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.',
};

/**
 * What the confirmation of an opening says about the work it starts (8 October decision 49).
 * The number is the database's (GET /api/waiting-work); the page never counts by itself.
 * 'counting': the number is on its way; 'unknown': it could not be read, so the sentence says
 * what may start without a number.
 */
export function waitingWorkSentence(
  kind: OpeningKind,
  waiting: number | 'counting' | 'unknown',
): string {
  if (waiting === 'counting') {
    return 'Bekleyen talepler sayılıyor.';
  }
  if (waiting === 'unknown') {
    return `Bekleyen talepler sayılamadı. ${WAITING_WORK_IF_ANY[kind]}`;
  }
  const where = WAITING_WHERE[kind];
  if (waiting === 0) {
    // Only what the number knows: no request would START. The database counts the work an
    // opening starts, so requests can wait all the same (a result that waits for a decision
    // behind the closed permission, a request that also waits for another switch), and "no
    // request waits" would be said beside a list that shows them.
    return kind === 'agent'
      ? `${where} bekleyip yeniden başlayacak talep yok; açmak hiçbir çalışmayı başlatmaz.`
      : `${where} yeniden başlayacak talep yok; izni açmak hiçbir çalışmayı başlatmaz.`;
  }
  const count = String(waiting);
  return `${where} ${count} talep bekliyor. ${kind === 'agent' ? 'Ajanı' : 'İzni'} açınca ${count} talebin çalışması hemen yeniden başlar; her biri ücretli bir yapay zekâ çalışmasıdır.`;
}

/** The two changes of a project's AI spending limit that start held work again. */
export type LimitLoosening = 'raise' | 'remove';

/**
 * What the confirmation of a raised or removed AI spending limit says about the work it starts
 * (11 October 2026, decision 1): the same sentence an opening says, with the act named. The
 * number is the database's, for the limit that is being confirmed: it is 0 while that limit would
 * still be reached by what the project has spent.
 */
export function limitWaitingWorkSentence(
  act: LimitLoosening,
  waiting: number | 'counting' | 'unknown',
): string {
  if (waiting === 'counting') {
    return 'Bekleyen talepler sayılıyor.';
  }
  const paid = 'her biri ücretli bir yapay zekâ çalışmasıdır.';
  if (waiting === 'unknown') {
    return `Bekleyen talepler sayılamadı. Bu projede bekleyen talep varsa ${
      act === 'raise' ? 'sınırı yükseltince' : 'sınırı kaldırınca'
    } hemen yeniden başlar; ${paid}`;
  }
  if (waiting === 0) {
    return `Bu projede yeniden başlayacak talep yok; ${
      act === 'raise' ? 'sınırı yükseltmek' : 'sınırı kaldırmak'
    } hiçbir çalışmayı başlatmaz.`;
  }
  const count = String(waiting);
  return `Bu projede ${count} talep bekliyor. ${
    act === 'raise' ? 'Sınırı yükseltince' : 'Sınırı kaldırınca'
  } ${count} talebin çalışması hemen yeniden başlar; ${paid}`;
}

/**
 * What the toast says after an opening that started work again: the number the API answered, which
 * can differ from the number the confirmation showed (a request was routed, closed or stopped in
 * the seconds between). Said only when something started.
 */
export function restartedSentence(count: number): string {
  return `Bekleyen ${String(count)} talebin çalışması yeniden başlatıldı.`;
}

/** Why the form does not take a request now. */
export const INTAKE_SENTENCE: Record<RequestIntakeReason, string> = {
  private_space: 'Kurucu alanında talep açılamaz. Bir şirket seçin.',
  coordinator_closed: 'Koordinasyon merkezi bu şirkette açık değil; şu an talep gönderilemez.',
  coordinator_not_ready:
    'Koordinasyon merkezi henüz çalışmaya hazır değil; şu an talep gönderilemez.',
  trial_founder_only: 'Ajanlar deneme aşamasında; şimdilik yalnızca kurucunun talepleri çalışır.',
};

/** What the founder can do about it. */
export const INTAKE_FOR_FOUNDER: Partial<Record<RequestIntakeReason, string>> = {
  coordinator_closed: 'Ofis görünümünde KOR-1 ajanını açın.',
  coordinator_not_ready:
    'KOR-1 kartının çalışacak sürümü yok ya da kart taslak durumunda. Depoda pnpm db:sync-definitions çalıştırılmalı.',
};

export function stageText(
  request: Pick<RequestSummary, 'stage' | 'cause' | 'waitingForMe' | 'delayed'>,
): string {
  const mine = request.waitingForMe ? STAGE_FOR_ME[request.stage] : undefined;
  // A request stopped after its approved result was delivered is not a cancelled piece of work,
  // and neither is one the routing returned to its requester: nobody cancelled it.
  const base =
    request.cause === 'closed_after_delivery'
      ? 'Kapatıldı'
      : request.cause === 'returned_no_agent'
        ? 'Geri çevrildi'
        : (mine ?? STAGE_LABEL[request.stage]);
  const cause =
    request.cause !== null && (request.stage === 'fell_to_person' || request.stage === 'cancelled')
      ? `: ${CAUSE_SHORT[request.cause]}`
      : '';
  return `${base}${cause}${request.delayed ? ' (gecikti)' : ''}`;
}

export function turnText(turn: RequestTurn, waitingForMe: boolean): string | null {
  if (waitingForMe) return 'Sizde';
  switch (turn.kind) {
    case 'agent':
      return turn.code;
    case 'person':
      return personName(turn);
    case 'founder':
      return 'Kurucu';
    case 'none':
      return null;
  }
}

export const REASON_LABEL: Record<RejectionReason, string> = {
  incorrect_information: 'Bilgi hatalı',
  incomplete: 'Eksik',
  language_and_tone: 'Dil ve ton',
  pricing: 'Fiyat',
  out_of_scope: 'Kapsam dışı',
  other: 'Diğer',
};

/**
 * The fixed verb of a tool, by its catalog name; an unknown tool is shown by its name. The
 * coordinator's tool is called for every answer it gives, also "no unit fits": its verb names the
 * decision, not a routing that may not have happened (the run's summary says which it was).
 */
const TOOL_VERB: Record<string, string> = {
  route_task: 'Yönlendirme kararını bildirdi',
  submit_for_approval: 'Onaya sundu',
  read_task: 'Talebi okudu',
  list_agents: 'Ajan listesine baktı',
  search_notes: 'Notlarda aradı',
  read_note: 'Not okudu',
  write_note: 'Taslak yazdı',
};

const STEP_RESULT: Record<string, string> = {
  started: 'sürüyor',
  succeeded: '',
  failed: 'olmadı',
  blocked: 'engellendi',
  sent_for_approval: 'onay bekliyor',
};

export function stepText(step: { tool: string; status: string }): string {
  const verb = TOOL_VERB[step.tool] ?? `Araç çağrısı: ${step.tool}`;
  const result = STEP_RESULT[step.status] ?? '';
  return result === '' ? verb : `${verb} (${result})`;
}

/** "38 sn. çalıştı, 1 adım": what was done, without claiming it went well. */
export function runLine(run: { durationMs: number | null; steps: readonly unknown[] }): string {
  const seconds = run.durationMs === null ? null : Math.max(1, Math.round(run.durationMs / 1000));
  const time =
    seconds === null
      ? 'Çalışıyor'
      : seconds < 60
        ? `${String(seconds)} sn. çalıştı`
        : `${String(Math.round(seconds / 60))} dk. çalıştı`;
  return `${time}, ${String(run.steps.length)} adım`;
}

/** The request is in a machine's hands: the page refreshes faster. */
export function machineHasTurn(request: Pick<RequestDetail, 'stage'>): boolean {
  return request.stage === 'routing' || request.stage === 'working' || request.stage === 'revising';
}

/**
 * The due day of a request in words, or null when it has none. "Son tarihi geçti" is said for an
 * open request whose day has ended (the API decides: `overdue`); never "gecikti", which is the
 * word of a run that takes too long.
 */
export function dueText(
  request: Pick<RequestSummary, 'dueDate' | 'overdue'>,
  now: number = Date.now(),
): string | null {
  if (request.dueDate === null) return null;
  return `${request.overdue ? 'Son tarihi geçti' : 'Son tarih'}: ${formatDay(request.dueDate, now)}`;
}

/**
 * The accessible sentence of a list row. `withProject`: the row shows the name of the request's
 * project (the Talepler screen), so the sentence names it after the title; on a project's own
 * page every row is of that project and none names it.
 */
export function rowSentence(
  request: RequestSummary,
  withProject = false,
  now: number = Date.now(),
): string {
  const turn = turnText(request.turn, request.waitingForMe);
  const due = dueText(request, now);
  const project = withProject && request.project ? `, proje ${request.project.name}` : '';
  return `${request.title}${project}, ${stageText(request)}${
    turn === null ? '' : `, sıra ${turn === 'Sizde' ? 'sizde' : turn}`
  }${due === null ? '' : `, ${due}`}`;
}
