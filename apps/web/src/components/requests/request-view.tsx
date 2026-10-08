import {
  DECISION_NOTE_MAX,
  ROUTING_NOTE_MAX,
  approvalDecisionDetails,
  rejectionReasonSchema,
  type ApprovalCard,
  type JourneyItem,
  type RejectionReason,
  type RequestDetail,
  type RequestResult,
} from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Banknote, Bot, KeyRound, Send } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { InlineBanner } from '@/components/inline-banner';
import { StatusIcon } from '@/components/status';
import { StepUpDialog } from '@/components/step-up';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { userMessage } from '@/lib/api';
import { formatMessageTime } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import { useDecisionDialog } from '@/lib/requests/hold';
import {
  CAUSE_FOR_FOUNDER,
  CAUSE_NEXT,
  CAUSE_SENTENCE,
  REASON_LABEL,
  RETURNED_NEXT,
  personName,
  returnedSentence,
  runLine,
  stepText,
  turnText,
} from '@/lib/requests/labels';
import {
  approvalDeskKey,
  correctRouting,
  decideAcceptance,
  decideApproval,
  requestKey,
  routingOptionsQueryOptions,
} from '@/lib/requests/query';
import { useSettle } from '@/lib/requests/settle';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * The parts of a request's page that are also used on the Onaylar screen: the approval card, the
 * acceptance card, the result and the journey.
 *
 * Rules that hold in every part: nothing is shown as decided before the API has stored it (the
 * buttons stay busy and a refusal is said in the card); a card cannot be dismissed; text an agent
 * wrote is drawn as plain text under a label that says whose words it is, apart from the marks
 * that come from the record (money, outside, passkey); a dialog gives the focus back to the
 * control that opened it; while a decision dialog is open the page does not read the request
 * again by itself, so the dialog and what was typed in it stay until the person sends or closes.
 */

/**
 * For a decision dialog that was closed without a decision: the request and the desk are read
 * again, so that what was held back while the dialog was open (lib/requests/hold.ts) shows now.
 */
function useCatchUp(requestId: string): () => void {
  const company = useCompany();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: requestKey(company.companyId, requestId),
      exact: true,
    });
    void queryClient.invalidateQueries({ queryKey: approvalDeskKey(company.companyId) });
  };
}

function AgentText({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-medium text-ink-secondary">{label}</div>
      {/* Plain text: line breaks kept, no markup, no link, no image (it is a model's output). */}
      <p dir="auto" className="text-sm whitespace-pre-wrap">
        {children}
      </p>
    </div>
  );
}

function Mark({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs">
      {icon}
      {children}
    </span>
  );
}

/**
 * A reason for sending work back. The approver picks a class from the fixed list (2 October
 * decision 10) and may add a note; the requester is asked only for their own sentence
 * (`askClass` false): they are not the ones who classify.
 */
function ReasonDialog({
  title,
  help,
  confirmLabel,
  askClass,
  busy,
  error,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  title: string;
  help: string;
  confirmLabel: string;
  askClass: boolean;
  busy: boolean;
  error: unknown;
  onConfirm: (reason: RejectionReason | null, note: string) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [reason, setReason] = useState<RejectionReason | ''>('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();
  const needsNote = !askClass || reason === 'other';
  const missingClass = askClass && reason === '';
  const reasonProblem = touched && missingClass ? 'Bir neden seçin.' : null;
  const noteProblem = touched && needsNote && note.trim() === '' ? 'Açıklama yazın.' : null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>{title}</DialogTitle>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (busy || missingClass || (needsNote && note.trim() === '')) return;
            onConfirm(reason === '' ? null : reason, note.trim());
          }}
        >
          {askClass ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-reason`} className="text-sm font-medium">
                Neden
              </label>
              <NativeSelect
                id={`${id}-reason`}
                value={reason}
                aria-invalid={reasonProblem !== null}
                onChange={(event) => {
                  const parsed = rejectionReasonSchema.safeParse(event.target.value);
                  setReason(parsed.success ? parsed.data : '');
                }}
              >
                <option value="">Seçin</option>
                {rejectionReasonSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {REASON_LABEL[value]}
                  </option>
                ))}
              </NativeSelect>
              {reasonProblem ? (
                <p role="alert" className="text-sm text-destructive">
                  {reasonProblem}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-note`} className="text-sm font-medium">
              Açıklama
            </label>
            <Textarea
              id={`${id}-note`}
              rows={3}
              maxLength={DECISION_NOTE_MAX}
              value={note}
              aria-invalid={noteProblem !== null}
              aria-describedby={`${id}-help`}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            {noteProblem ? (
              <p role="alert" className="text-sm text-destructive">
                {noteProblem}
              </p>
            ) : null}
            <p id={`${id}-help`} className="text-sm text-ink-secondary">
              {help}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              {...busyProps(busy)}
              onClick={() => {
                if (!busy) onClose();
              }}
            >
              Vazgeç
            </Button>
            <Button type="submit" {...busyProps(busy)}>
              {busy ? 'Gönderiliyor' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A result that waits for the decision of the unit's approver. Given only to a person who may
 * decide it (the API sends the card to nobody else).
 */
export function ApprovalCardView({
  card,
  showRequestLink = false,
}: {
  card: ApprovalCard;
  showRequestLink?: boolean;
}) {
  const company = useCompany();
  const settle = useSettle();
  const headingId = useId();
  const hintId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'changes_requested' | 'rejected' | 'passkey' | null>(null);
  useDecisionDialog(dialog !== null);
  const catchUp = useCatchUp(card.requestId);
  const focus = useReturnFocus();
  const hasOptions = card.options.length > 0;
  const chosen = hasOptions ? selected : null;
  const missingOption = hasOptions && selected === null;

  const decide = useMutation({
    mutationFn: (decision: Parameters<typeof decideApproval>[2]) =>
      decideApproval(company.companyId, card.id, decision),
    onSuccess: (detail) => {
      setDialog(null);
      settle(detail);
    },
  });

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 id={headingId} className="text-[0.9375rem] font-semibold">
          {card.title}
        </h3>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-secondary">
          <span className="inline-flex items-center gap-1">
            <Bot aria-hidden="true" className="size-3.5" />
            {card.agent.code} onayınıza sundu
          </span>
          {card.attempt > 1 ? <span>{card.attempt}. deneme</span> : null}
          <span>Talep sahibi: {personName(card.requester)}</span>
          {showRequestLink ? (
            <Link
              to="/c/$company/requests/$requestId"
              params={{ company: company.code, requestId: card.requestId }}
              className="font-medium text-brand underline underline-offset-4"
            >
              Talebi aç
            </Link>
          ) : null}
        </p>
      </header>
      {card.goesExternal || card.involvesMoney || card.needsStepUp ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Kayıttan gelen işaretler">
          {card.goesExternal ? (
            <Mark icon={<Send aria-hidden="true" className="size-3" />}>Dışarı gidecek</Mark>
          ) : null}
          {card.involvesMoney ? (
            <Mark icon={<Banknote aria-hidden="true" className="size-3" />}>
              {card.moneyStatedBy === 'agent'
                ? 'Para içeriyor (ajan belirtti)'
                : card.moneyStatedBy === 'default'
                  ? 'Para içerebilir (kart belirtmiyor)'
                  : 'Para içeriyor'}
            </Mark>
          ) : null}
          {card.needsStepUp ? (
            <Mark icon={<KeyRound aria-hidden="true" className="size-3" />}>Passkey ister</Mark>
          ) : null}
        </div>
      ) : null}
      {card.summary ? <AgentText label="Özet (ajan yazdı)">{card.summary}</AgentText> : null}
      {hasOptions ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-xs font-medium text-ink-secondary">Seçenekler</legend>
          {card.options.map((option) => (
            <label
              key={option.code}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-checked:border-brand"
            >
              <input
                type="radio"
                name={`${headingId}-option`}
                className="mt-1 size-4 accent-(--brand)"
                checked={selected === option.code}
                onChange={() => {
                  setSelected(option.code);
                }}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-medium text-ink-secondary">
                  Seçenek {option.code}
                </span>
                <span dir="auto" className="text-sm whitespace-pre-wrap">
                  {option.text}
                </span>
                {option.hashtags.length > 0 ? (
                  <span className="text-sm text-ink-secondary">{option.hashtags.join(' ')}</span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {card.rationale ? <AgentText label="Ajanın gerekçesi">{card.rationale}</AgentText> : null}
      {card.riskNote ? <AgentText label="Ajanın risk notu">{card.riskNote}</AgentText> : null}
      {decide.isError && dialog === null ? (
        <p role="alert" className="text-sm text-destructive">
          {userMessage(decide.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          {...busyProps(decide.isPending || missingOption)}
          aria-describedby={missingOption ? hintId : undefined}
          onClick={() => {
            if (decide.isPending || missingOption) return;
            if (card.needsStepUp) {
              focus.remember();
              setDialog('passkey');
            } else {
              decide.mutate({
                decision: 'approved',
                ...(chosen ? { selectedOption: chosen } : {}),
              });
            }
          }}
        >
          {decide.isPending && dialog === null ? 'Onaylanıyor' : 'Onayla'}
        </Button>
        <Button
          variant="outline"
          size="lg"
          {...busyProps(decide.isPending)}
          onClick={() => {
            if (decide.isPending) return;
            focus.remember();
            setDialog('changes_requested');
          }}
        >
          Düzeltme iste
        </Button>
        <Button
          variant="destructive"
          size="lg"
          {...busyProps(decide.isPending)}
          onClick={() => {
            if (decide.isPending) return;
            focus.remember();
            setDialog('rejected');
          }}
        >
          Reddet
        </Button>
        {missingOption ? (
          <span id={hintId} className="text-sm text-ink-secondary">
            Onaylamak için önce bir seçenek seçin.
          </span>
        ) : null}
      </div>
      {dialog === 'changes_requested' || dialog === 'rejected' ? (
        <ReasonDialog
          title={dialog === 'rejected' ? 'Sonucu reddet' : 'Düzeltme iste'}
          help={
            dialog === 'rejected'
              ? 'Reddedilen sonuçla birlikte talep kapanır. Talep sahibi nedeni ve açıklamanızı okur; ajanın yazdığını okumaz.'
              : card.attempt > 1
                ? 'Bu ikinci düzeltme isteği olur; iş ajana dönmez, size düşer.'
                : 'İş, yazdığınız açıklamayla aynı ajana geri döner.'
          }
          confirmLabel={dialog === 'rejected' ? 'Reddet' : 'Düzeltme iste'}
          askClass
          busy={decide.isPending}
          error={decide.isError ? decide.error : null}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          onClose={() => {
            decide.reset();
            setDialog(null);
            catchUp();
          }}
          onConfirm={(reason, note) => {
            if (reason === null) return;
            decide.mutate({ decision: dialog, reason, ...(note === '' ? {} : { note }) });
          }}
        />
      ) : null}
      {/* An important approval is sent only together with a passkey answer made for this option. */}
      <StepUpDialog<RequestDetail>
        open={dialog === 'passkey'}
        onOpenChange={(open) => {
          if (open) return;
          setDialog(null);
          catchUp();
        }}
        request={
          dialog === 'passkey'
            ? {
                purpose: 'approve',
                companyId: company.companyId,
                subjectId: card.id,
                details: approvalDecisionDetails(chosen ?? undefined),
              }
            : null
        }
        action={(stepUp) =>
          decideApproval(company.companyId, card.id, {
            decision: 'approved',
            ...(chosen ? { selectedOption: chosen } : {}),
            stepUp,
          })
        }
        onSuccess={(detail) => {
          setDialog(null);
          settle(detail);
        }}
        title="Sonucu onayla"
        description={
          chosen
            ? `Seçenek ${chosen} onaylanacak ve talep sahibine iletilecek. Bu içerik şirket dışına gidecek.`
            : 'Sonuç onaylanacak ve talep sahibine iletilecek.'
        }
        confirmLabel="Passkey ile onayla"
        onCloseAutoFocus={focus.onCloseAutoFocus}
      />
    </section>
  );
}

/** The approved result: what the requester is asked to accept, and what stays on the page. */
export function ResultBlock({ result }: { result: RequestResult }) {
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  const option = result.option;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-line p-4"
    >
      <header className="flex flex-wrap items-baseline gap-x-2">
        <h3 id={headingId} className="text-[0.9375rem] font-semibold">
          Sonuç
        </h3>
        <p className="text-sm text-ink-secondary">
          {result.agent.code} hazırladı
          {result.approvedBy ? `; ${personName(result.approvedBy)} onayladı` : ''},{' '}
          {formatMessageTime(result.approvedAt)}
        </p>
      </header>
      {option ? (
        <>
          <p dir="auto" className="text-sm whitespace-pre-wrap">
            {option.text}
          </p>
          {option.hashtags.length > 0 ? (
            <p className="text-sm text-ink-secondary">{option.hashtags.join(' ')}</p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                const text = [option.text, option.hashtags.join(' ')].filter(Boolean).join('\n\n');
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                });
              }}
            >
              Metni kopyala
            </Button>
            <span role="status" className="text-sm text-ink-secondary">
              {copied ? 'Kopyalandı.' : ''}
            </span>
          </div>
          <p className="text-sm text-ink-secondary">
            Yayınlamak bir kişinin işidir; ajan bu metni hiçbir yere göndermedi.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-secondary">{result.title}</p>
      )}
    </section>
  );
}

/** The requester's answer to the approved result (7 October decision 6). */
export function AcceptanceCardView({
  requestId,
  approver,
  returnsToAgent,
}: {
  requestId: string;
  approver: string | null;
  /**
   * What "İstediğim bu değil" does this time, as the API says it: true, the work goes back to the
   * same agent (the requester has not asked for changes on this request before); false, it falls
   * to the founder (8 October decision 3). Not the round of the acceptance: a routing correction
   * opens a new round without the requester having said anything.
   */
  returnsToAgent: boolean;
}) {
  const company = useCompany();
  const settle = useSettle();
  const headingId = useId();
  const [asking, setAsking] = useState(false);
  useDecisionDialog(asking);
  const catchUp = useCatchUp(requestId);
  const focus = useReturnFocus();
  const decide = useMutation({
    mutationFn: (decision: Parameters<typeof decideAcceptance>[2]) =>
      decideAcceptance(company.companyId, requestId, decision),
    onSuccess: (detail) => {
      setAsking(false);
      settle(detail);
    },
  });
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h3 id={headingId} className="text-[0.9375rem] font-semibold">
        Sonuç hazır
      </h3>
      <p className="text-sm">
        {approver ? `${approver} onayladı. ` : ''}Sonucu aşağıda görebilirsiniz. İstediğiniz buysa
        onaylayın; talep tamamlanır.
      </p>
      {decide.isError && !asking ? (
        <p role="alert" className="text-sm text-destructive">
          {userMessage(decide.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          {...busyProps(decide.isPending)}
          onClick={() => {
            if (!decide.isPending) decide.mutate({ decision: 'approved' });
          }}
        >
          {decide.isPending && !asking ? 'Onaylanıyor' : 'Sonucu onayla'}
        </Button>
        <Button
          variant="outline"
          size="lg"
          {...busyProps(decide.isPending)}
          onClick={() => {
            if (decide.isPending) return;
            focus.remember();
            setAsking(true);
          }}
        >
          İstediğim bu değil
        </Button>
      </div>
      {asking ? (
        <ReasonDialog
          title="İstediğim bu değil"
          help={
            returnsToAgent
              ? 'Neyin eksik ya da yanlış olduğunu yazın. İş bu açıklamayla aynı ajana bir kez geri döner; yeni sonuç önce birim onayına, sonra size gelir.'
              : 'Neyin eksik ya da yanlış olduğunu yazın. Bu ikinci isteğiniz: iş ajana kendiliğinden dönmez, kurucuya düşer.'
          }
          confirmLabel="Gönder"
          askClass={false}
          busy={decide.isPending}
          error={decide.isError ? decide.error : null}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          onClose={() => {
            decide.reset();
            setAsking(false);
            catchUp();
          }}
          onConfirm={(_reason, note) => {
            decide.mutate({ decision: 'changes_requested', note });
          }}
        />
      ) : null}
    </section>
  );
}

/** Why a request fell to a person, and what can be done about it. */
export function FellNotice({ request, isFounder }: { request: RequestDetail; isFounder: boolean }) {
  if (request.stage !== 'fell_to_person' || request.cause === null) return null;
  const lastRun = request.journey.findLast((item) => item.kind === 'run');
  // Given by the API only to a person who may decide the work; null for everybody else.
  const said = lastRun?.kind === 'run' ? lastRun.agentText : null;
  const canAct = request.actions.reroute;
  const next = canAct ? CAUSE_NEXT[request.cause] : undefined;
  const forFounder = isFounder ? CAUSE_FOR_FOUNDER[request.cause] : undefined;
  const turn = turnText(request.turn, request.waitingForMe);
  return (
    <InlineBanner tone="warning">
      <div className="flex flex-col gap-2">
        <p>{CAUSE_SENTENCE[request.cause]}</p>
        {said && lastRun?.kind === 'run' ? (
          <AgentText
            label={`${lastRun.agent.code} şunu yazdı (onaylanmadı; yalnızca siz görürsünüz)`}
          >
            {said}
          </AgentText>
        ) : null}
        {forFounder ? <p>{forFounder}</p> : null}
        {next ? <p>{next}</p> : null}
        {/* Every founder and employee of the company can read this page: the sentence does not
            address the reader as the owner of the request. */}
        {!canAct ? (
          <p className="text-ink-secondary">
            Talep kayıtlı.{' '}
            {turn && turn !== 'Sizde' ? `Sıradaki adımı ${turn} atacak.` : 'Bir kişi ilgilenecek.'}
          </p>
        ) : null}
      </div>
    </InlineBanner>
  );
}

/**
 * How a cancelled request was closed: who closed it and that person's own words, or that the
 * routing returned it because the unit has no open agent (8 October decision 2; a fixed sentence
 * with the unit's name). The answer goes back to the requester also when it is no (7 October
 * decision 4). Nothing here is an agent's text.
 */
export function ClosedNotice({ request }: { request: RequestDetail }) {
  if (request.stage !== 'cancelled' || request.cause === null) return null;
  if (request.cause === 'returned_no_agent') {
    return (
      <InlineBanner tone="info">
        <div className="flex flex-col gap-2">
          <p>{returnedSentence(request.unit?.name ?? null)}</p>
          <p className="text-ink-secondary">{RETURNED_NEXT}</p>
        </div>
      </InlineBanner>
    );
  }
  const closure = request.closure;
  const who = closure?.by ? personName(closure.by) : null;
  const sentence =
    request.cause === 'rejected'
      ? `${who ?? 'Birimin onaylayıcısı'} sonucu reddetti${
          closure?.reason ? `: ${REASON_LABEL[closure.reason]}.` : '.'
        }`
      : request.cause === 'stopped'
        ? `${who ?? 'Bir yetkili'} işi durdurdu.`
        : request.cause === 'closed_after_delivery'
          ? `${who ?? 'Bir yetkili'} talebi kapattı. Onaylanan sonuç aşağıda; talep sahibi yanıt vermemişti.`
          : `${who ?? 'Talep sahibi'} talebi iptal etti.`;
  return (
    <InlineBanner tone="info">
      <div className="flex flex-col gap-2">
        <p>{sentence}</p>
        {closure?.note ? (
          <p dir="auto" className="whitespace-pre-wrap">
            {closure.note}
          </p>
        ) : null}
        {request.cause === 'rejected' || request.cause === 'stopped' ? (
          <p className="text-ink-secondary">
            Bu talep kapandı. İş hâlâ gerekiyorsa yeni bir talep gönderebilirsiniz.
          </p>
        ) : null}
      </div>
    </InlineBanner>
  );
}

/**
 * "Yönlendirmeyi düzelt" (7 October decision 7): the founder or the approver of the request gives
 * it to a unit and an agent of that unit that is open. An agent is always chosen: a unit without
 * an open agent is listed, so that the person sees why it cannot be chosen, and cannot be picked
 * (a request is not left where nobody can do it; the person closes it instead). Giving the request
 * to the agent that already had it starts the work again. The approver of the new step is not
 * chosen here: the database appoints the unit's.
 */
export function RerouteDialog({
  request,
  onClose,
  onCloseAutoFocus,
}: {
  request: RequestDetail;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const settle = useSettle();
  const id = useId();
  const options = useQuery(routingOptionsQueryOptions(company.companyId, request.id));
  const [unit, setUnit] = useState(request.unit?.code ?? '');
  const [agent, setAgent] = useState(request.agent?.code ?? '');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const units = options.data?.units ?? [];
  // A unit without an open agent is not a choice, also when it is the request's own unit.
  const chosen = units.find((candidate) => candidate.code === unit && candidate.agents.length > 0);
  // An agent that is not open any more is not a choice.
  const agentCode = chosen?.agents.some((candidate) => candidate.code === agent) ? agent : '';
  // Nothing can be chosen: no unit of the company has an open agent now.
  const nowhere = options.isSuccess && units.every((candidate) => candidate.agents.length === 0);
  const send = useMutation({
    mutationFn: () =>
      correctRouting(company.companyId, request.id, {
        unitCode: unit,
        agentCode,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    onSuccess: (detail) => {
      settle(detail);
      onClose();
    },
  });
  const unitProblem = touched && !chosen ? 'Bir birim seçin.' : null;
  const agentProblem = touched && chosen && agentCode === '' ? 'Bir ajan seçin.' : null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !send.isPending) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>Yönlendirmeyi düzelt</DialogTitle>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (send.isPending || nowhere || !chosen || agentCode === '') return;
            send.mutate();
          }}
        >
          {options.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(options.error)}
            </p>
          ) : null}
          {nowhere ? (
            <p className="text-sm">
              Şu an hiçbir birimde açık ajan yok; talep bir ajana verilemez.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-unit`} className="text-sm font-medium">
                  Birim
                </label>
                <NativeSelect
                  id={`${id}-unit`}
                  value={chosen ? unit : ''}
                  aria-invalid={unitProblem !== null}
                  aria-busy={options.isPending}
                  onChange={(event) => {
                    setUnit(event.target.value);
                    setAgent('');
                  }}
                >
                  <option value="">{options.isPending ? 'Yükleniyor' : 'Seçin'}</option>
                  {units.map((candidate) => (
                    <option
                      key={candidate.code}
                      value={candidate.code}
                      disabled={candidate.agents.length === 0}
                    >
                      {candidate.name}
                      {candidate.agents.length === 0 ? ' (açık ajan yok)' : ''}
                    </option>
                  ))}
                </NativeSelect>
                {unitProblem ? (
                  <p role="alert" className="text-sm text-destructive">
                    {unitProblem}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-agent`} className="text-sm font-medium">
                  Ajan
                </label>
                <NativeSelect
                  id={`${id}-agent`}
                  value={agentCode}
                  aria-invalid={agentProblem !== null}
                  aria-describedby={`${id}-agent-help`}
                  disabled={!chosen}
                  onChange={(event) => {
                    setAgent(event.target.value);
                  }}
                >
                  <option value="">Seçin</option>
                  {(chosen?.agents ?? []).map((candidate) => (
                    <option key={candidate.code} value={candidate.code}>
                      {candidate.code} {candidate.name}
                    </option>
                  ))}
                </NativeSelect>
                {agentProblem ? (
                  <p role="alert" className="text-sm text-destructive">
                    {agentProblem}
                  </p>
                ) : null}
                <p id={`${id}-agent-help`} className="text-sm text-ink-secondary">
                  Yalnızca bu şirkette açık olan ajanlar listelenir. Seçtiğiniz ajan işe yeni bir
                  çalışmayla başlar; aynı ajanı yeniden seçmek işi baştan başlatır. Bekleyen onay
                  varsa kapanır.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-note`} className="text-sm font-medium">
                  Açıklama (isteğe bağlı)
                </label>
                <Textarea
                  id={`${id}-note`}
                  rows={2}
                  maxLength={ROUTING_NOTE_MAX}
                  value={note}
                  aria-describedby={`${id}-note-help`}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
                <p id={`${id}-note-help`} className="text-sm text-ink-secondary">
                  Talebi görebilen herkes okur; ajana da iletilir.
                </p>
              </div>
            </>
          )}
          {send.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(send.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              {...busyProps(send.isPending)}
              onClick={() => {
                if (!send.isPending) onClose();
              }}
            >
              Vazgeç
            </Button>
            {/* Nothing to choose, so nothing to send. */}
            {nowhere ? null : (
              <Button type="submit" {...busyProps(send.isPending)}>
                {send.isPending ? 'Yönlendiriliyor' : 'Yönlendir'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The mark of a row that is an event, not a record with a status of its own. */
function EventMark() {
  return <span aria-hidden="true" className="size-1.5 rounded-full bg-ink-secondary" />;
}

function JourneyRow({
  icon,
  time,
  children,
}: {
  icon: ReactNode;
  time: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 py-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">{children}</div>
      <time dateTime={time} className="shrink-0 text-xs text-ink-secondary tabular-nums">
        {formatMessageTime(time)}
      </time>
    </li>
  );
}

function RunItem({
  item,
  textShownAbove,
}: {
  item: Extract<JourneyItem, { kind: 'run' }>;
  /** The notice at the top of the page already shows what this run's agent wrote. */
  textShownAbove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  return (
    <JourneyRow icon={<StatusIcon kind="run" status={item.status} labelled />} time={item.at}>
      <p>
        <span className="font-medium">{item.agent.code}</span> {item.agent.name}
      </p>
      {/* A sentence made by code, never a model's text. */}
      {item.summary ? <p>{item.summary}</p> : null}
      {item.agentText && !textShownAbove ? (
        <AgentText label={`${item.agent.code} şunu yazdı (onaylanmadı; yalnızca siz görürsünüz)`}>
          {item.agentText}
        </AgentText>
      ) : null}
      <button
        type="button"
        className="self-start text-xs text-ink-secondary underline underline-offset-4"
        aria-expanded={open}
        aria-controls={stepsId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {runLine(item)}
      </button>
      {open ? (
        <ul id={stepsId} className="flex flex-col gap-0.5 text-xs text-ink-secondary">
          {item.steps.length === 0 ? <li>Araç çağrısı yok.</li> : null}
          {item.steps.map((step, index) => (
            <li key={index}>{stepText(step)}</li>
          ))}
        </ul>
      ) : null}
    </JourneyRow>
  );
}

/** What happened, in order, already cut by the API to what the reader may read. */
export function Journey({ request }: { request: RequestDetail }) {
  const headingId = useId();
  // The words of the run a request fell on are in the notice at the top; not said twice.
  const fellOn =
    request.stage === 'fell_to_person'
      ? request.journey.findLast((item) => item.kind === 'run')?.id
      : undefined;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-[0.9375rem] font-semibold">
        Yolculuk
      </h3>
      <ol className="flex flex-col divide-y divide-line">
        <JourneyRow icon={<EventMark />} time={request.createdAt}>
          <p>
            <span className="font-medium">{personName(request.requester)}</span> talebi gönderdi.
          </p>
        </JourneyRow>
        {request.journey.map((item) => {
          switch (item.kind) {
            case 'run':
              return <RunItem key={item.id} item={item} textShownAbove={item.id === fellOn} />;
            case 'routing':
              return (
                <JourneyRow key={item.id} icon={<EventMark />} time={item.at}>
                  <p>
                    {item.by ? (
                      <>
                        <span className="font-medium">{personName(item.by)}</span> yönlendirmeyi
                        düzeltti:
                      </>
                    ) : (
                      'Koordinasyon merkezi talebi yönlendirdi:'
                    )}{' '}
                    <span className="font-medium">{item.unit.name}</span>
                    {/* A step without an agent is a returned step: nobody works on it and nobody
                        approves anything, so no approver is named. That the request went back to
                        its requester is said by the notice and by the run's own summary. */}
                    {item.agent
                      ? `, ajan ${item.agent.code} ${item.agent.name}. Onaylayıcı: ${
                          item.approver ? personName(item.approver) : 'Kurucu'
                        }.`
                      : '; birimde bu işi alabilecek açık ajan yok.'}
                  </p>
                  {item.reason ? (
                    item.by ? (
                      <p dir="auto" className="whitespace-pre-wrap text-ink-secondary">
                        {item.reason}
                      </p>
                    ) : (
                      <AgentText label="Koordinasyon merkezinin gerekçesi (yalnızca siz görürsünüz)">
                        {item.reason}
                      </AgentText>
                    )
                  ) : null}
                </JourneyRow>
              );
            case 'approval':
              return (
                <JourneyRow
                  key={item.id}
                  icon={
                    <StatusIcon
                      kind="approval"
                      status={item.status === 'closed' ? 'rejected' : item.status}
                      labelled={false}
                    />
                  }
                  time={item.at}
                >
                  <p>
                    {item.status === 'pending'
                      ? `${item.agent.code} sonucu onaya sundu.`
                      : item.status === 'closed'
                        ? 'Bekleyen onay kapandı: talep değişti.'
                        : `${item.decidedBy ? personName(item.decidedBy) : 'Onaylayıcı'} ${
                            item.status === 'approved'
                              ? 'sonucu onayladı.'
                              : item.status === 'rejected'
                                ? 'sonucu reddetti'
                                : 'düzeltme istedi'
                          }${item.reason && item.status !== 'approved' ? `: ${REASON_LABEL[item.reason]}.` : ''}`}
                    {item.attempt > 1 ? ` (${String(item.attempt)}. deneme)` : ''}
                  </p>
                  {item.note ? (
                    <p className="whitespace-pre-wrap text-ink-secondary">{item.note}</p>
                  ) : null}
                </JourneyRow>
              );
            case 'acceptance':
              return (
                <JourneyRow
                  key={item.id}
                  icon={
                    <StatusIcon
                      kind="approval"
                      status={
                        item.status === 'approved'
                          ? 'approved'
                          : item.status === 'changes_requested'
                            ? 'changes_requested'
                            : item.status === 'closed'
                              ? 'rejected'
                              : 'pending'
                      }
                      labelled={false}
                    />
                  }
                  time={item.at}
                >
                  <p>
                    {item.status === 'pending'
                      ? 'Sonuç talep sahibine iletildi; talep sahibinin onayı bekleniyor.'
                      : item.status === 'approved'
                        ? `${personName(request.requester)} sonucu onayladı.`
                        : item.status === 'closed'
                          ? 'Talep sahibinin onayı kapandı: talep değişti.'
                          : `${personName(request.requester)} "istediğim bu değil" dedi${
                              item.reason ? `: ${REASON_LABEL[item.reason]}.` : '.'
                            }`}
                  </p>
                  {item.note ? (
                    <p className="whitespace-pre-wrap text-ink-secondary">{item.note}</p>
                  ) : null}
                </JourneyRow>
              );
          }
        })}
      </ol>
    </section>
  );
}
