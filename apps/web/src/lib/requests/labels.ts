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
  // Read only while the agent is open: while it is stopped the cause is agent_stopped (or
  // coordinator_closed). So the notice can say that the agent is open and must say that this
  // alone starts nothing.
  not_started:
    'Ajanın çalışması başlatılamadı: iş verildiğinde ajan kapalıydı ya da çalışmaya hazır değildi. Ajan şimdi açık, ama iş kendiliğinden başlamaz.',
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
 * again and starts a new run. No sentence here promises that opening an agent revives a request by
 * itself. A closed request (returned, cancelled, stopped, rejected) has no way on and no entry.
 */
export const CAUSE_NEXT: Partial<Record<RequestCause, string>> = {
  coordinator_closed:
    'Koordinasyon merkezi bu talebi kendiliğinden yeniden ele almaz. "Yönlendirmeyi düzelt" ile talebi bir birime ve ajana kendiniz verebilirsiniz.',
  no_routing: '"Yönlendirmeyi düzelt" ile talebi bir birime ve ajana kendiniz verebilirsiniz.',
  agent_stopped:
    'Ajanı Ofis görünümünden yeniden açmak bu talebi kendiliğinden başlatmaz. Açtıktan sonra "Yönlendirmeyi düzelt" ile işi yeniden verin.',
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
    'Kart taslak durumunda, ya da deneme durumunda ve talep kurucuya ait değil. Kartın durumu depoda değiştirilir.',
};

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

/** The accessible sentence of a list row. */
export function rowSentence(request: RequestSummary, now: number = Date.now()): string {
  const turn = turnText(request.turn, request.waitingForMe);
  const due = dueText(request, now);
  return `${request.title}, ${stageText(request)}${
    turn === null ? '' : `, sıra ${turn === 'Sizde' ? 'sizde' : turn}`
  }${due === null ? '' : `, ${due}`}`;
}
