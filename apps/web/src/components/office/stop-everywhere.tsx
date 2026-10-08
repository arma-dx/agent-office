import type { MembershipSummary } from '@agent-office/shared';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { useReturnFocus } from '@/lib/focus';
import { useOfficeDialog } from '@/lib/office/hold';
import type { OfficeAgent } from '@/lib/office/model';
import { agentSwitchQueryOptions, officeKey, stopAgentIfOpen } from '@/lib/office/query';
import { companyLabel, useSession } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/** What the stop did in one place. */
type Outcome =
  | { kind: 'stopped' }
  | { kind: 'already_stopped' }
  | { kind: 'not_open' }
  | { kind: 'failed'; message: string };

// "durduruldu" is said only of an agent this act stopped (the API's `changed`): an agent somebody
// had stopped before is told as such, and a closed one as not open.
const OUTCOME_TEXT: Record<Exclude<Outcome['kind'], 'failed'>, string> = {
  stopped: 'durduruldu.',
  already_stopped: 'zaten durdurulmuş, bir şey değişmedi.',
  not_open: 'açık değildi, bir şey değişmedi.',
};

/**
 * "Her yerde durdur" (8 October decision 9; docs/SONRA.md W-f): the founder stops an agent in
 * every company where it is open, from the panel of the selected agent. No passkey, as for the
 * switch of one company.
 *
 * Every request of the panel runs in one company (rule 9), so nothing here is one act of the
 * server: the confirmation first reads the agent's switch in each company the person is the
 * founder of and names those where it is open; then one stop is sent per company, one after the
 * other, each of which stops only an agent that is open there. A company where the agent is closed
 * or stopped is sent nothing and stays as it is. What happened is told company by company, and a
 * company that could not be stopped can be tried again. Opening again is done company by company
 * with the switch.
 *
 * The texts say "yer", the word of the button, and never "şirket": Kurucu alanı is one of the
 * places and is not a company. Each place is named as the company menu names it.
 *
 * Offered only to a person who is the founder of more than one company: for anybody else the
 * switch of the company is the same act.
 */
export function StopEverywhere({ agent }: { agent: OfficeAgent }) {
  const session = useSession();
  const companies = session.memberships.filter((membership) => membership.role === 'founder');
  const [open, setOpen] = useState(false);
  // The dialog is opened from state and has no trigger: the focus goes back to the button here.
  const focus = useReturnFocus();
  useOfficeDialog(open);
  if (companies.length < 2) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          focus.remember();
          setOpen(true);
        }}
      >
        Her yerde durdur
      </Button>
      {open ? (
        <StopEverywhereDialog
          agentCode={agent.code}
          companies={companies}
          onClose={() => {
            setOpen(false);
          }}
          onCloseAutoFocus={focus.onCloseAutoFocus}
        />
      ) : null}
    </>
  );
}

/** Mounted only while it is open, so every opening reads the switches anew. */
function StopEverywhereDialog({
  agentCode,
  companies,
  onClose,
  onCloseAutoFocus,
}: {
  agentCode: string;
  companies: readonly MembershipSummary[];
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const queryClient = useQueryClient();
  const reads = useQueries({
    queries: companies.map((company) => agentSwitchQueryOptions(company.companyId, agentCode)),
  });
  const stop = useMutation({
    mutationFn: (companyId: string) => stopAgentIfOpen(companyId, agentCode),
  });
  const [phase, setPhase] = useState<'confirm' | 'sending' | 'done'>('confirm');
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  // The companies the first send went to, in the order of the company menu.
  const [sent, setSent] = useState<readonly MembershipSummary[]>([]);
  // The send on its way is a retry: the button that was pressed stays, busy, until it is answered.
  const [retrying, setRetrying] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);

  const reading = reads.some((read) => read.isPending);
  // Open, or not known: a stop sent to a company whose switch could not be read stops the agent
  // only if it is open there.
  const targets = companies.filter((_, index) => {
    const read = reads[index];
    return read?.isError === true || read?.data === 'enabled';
  });
  const unread = new Set(
    companies.filter((_, index) => reads[index]?.isError === true).map((c) => c.companyId),
  );
  const failed = sent.filter((company) => outcomes.get(company.companyId)?.kind === 'failed');
  const sending = phase === 'sending';

  const send = async (list: readonly MembershipSummary[], retry: boolean) => {
    setSent((previous) => (previous.length === 0 ? list : previous));
    setRetrying(retry);
    setPhase('sending');
    // A place that is asked has no result until it answers: what a retry is asking again reads
    // "durduruluyor." and not its earlier failure.
    setOutcomes((previous) => {
      const next = new Map(previous);
      for (const company of list) next.delete(company.companyId);
      return next;
    });
    for (const company of list) {
      let outcome: Outcome;
      try {
        const after = await stop.mutateAsync(company.companyId);
        outcome = {
          kind: after.changed
            ? 'stopped'
            : after.status === 'stopped'
              ? 'already_stopped'
              : 'not_open',
        };
      } catch (error) {
        outcome = { kind: 'failed', message: userMessage(error) };
      }
      setOutcomes((previous) => new Map(previous).set(company.companyId, outcome));
    }
    // The result is shown as soon as the last place answered. The button that was pressed is gone
    // when nothing is left to try: the focus goes to the one that closes. A retry that failed
    // again keeps its button and the focus on it.
    flushSync(() => {
      setPhase('done');
    });
    if (retryButton.current === null || document.activeElement !== retryButton.current) {
      closeButton.current?.focus();
    }
    // Then the office of every place that was asked is read again: the scene behind the dialog,
    // and the other places' offices when the person goes there. Not waited for: the result must
    // not depend on a read that may take long or fail. A retry reads the offices of the first
    // send too, because their read after it may have failed with the stop that is tried again.
    for (const company of sent.length > 0 ? sent : list) {
      void queryClient.invalidateQueries({ queryKey: officeKey(company.companyId) });
    }
  };

  const asked = phase !== 'confirm';
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !sending) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogTitle>
          {asked ? `${agentCode} için sonuç` : `${agentCode} her yerde durdurulsun mu?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {asked
            ? 'Her yer için sonuç aşağıda. Yeniden açma her yerde ayrı yapılır.'
            : reading
              ? 'Ajanın nerede açık olduğu denetleniyor.'
              : targets.length === 0
                ? 'Bu ajan, kurucusu olduğunuz hiçbir yerde açık değil. Durdurulacak bir şey yok.'
                : 'Yeni iş almaz; süren çalışması bir sonraki adımdan önce durur. Kapalı ya da durdurulmuş olduğu yerde bir şey değişmez. Yeniden açma her yerde ayrı yapılır.'}
        </AlertDialogDescription>
        {!asked && !reading && targets.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>Durdurulacağı yerler:</p>
            <ul role="list" aria-label="Durdurulacağı yerler" className="flex flex-col gap-1">
              {targets.map((company) => (
                <li key={company.companyId}>
                  <span className="font-medium">{companyLabel(company)}</span>
                  {unread.has(company.companyId)
                    ? ': durumu okunamadı; ajan orada açıksa durdurulur.'
                    : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {asked ? (
          <ul
            role="list"
            aria-label="Sonuç"
            aria-live="polite"
            className="flex flex-col gap-1 text-sm"
          >
            {sent.map((company) => {
              const outcome = outcomes.get(company.companyId);
              // Each place says what happened as soon as it answered, a failure too: the others
              // may take long.
              const waiting = outcome === undefined;
              return (
                <li key={company.companyId}>
                  <span className="font-medium">{companyLabel(company)}</span>
                  {': '}
                  {waiting ? (
                    'durduruluyor.'
                  ) : outcome.kind === 'failed' ? (
                    <span className="text-destructive">durdurulamadı. {outcome.message}</span>
                  ) : (
                    OUTCOME_TEXT[outcome.kind]
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            ref={closeButton}
            {...busyProps(sending)}
            onClick={(event) => {
              if (sending) event.preventDefault();
            }}
          >
            {asked || (!reading && targets.length === 0) ? 'Kapat' : 'Vazgeç'}
          </AlertDialogCancel>
          {(phase === 'done' && failed.length > 0) || (sending && retrying) ? (
            <Button
              ref={retryButton}
              size="lg"
              {...busyProps(sending)}
              onClick={() => {
                if (!sending) void send(failed, true);
              }}
            >
              Yeniden dene
            </Button>
          ) : null}
          {(phase === 'confirm' && !reading && targets.length > 0) || (sending && !retrying) ? (
            <Button
              size="lg"
              {...busyProps(sending)}
              onClick={() => {
                if (!sending) void send(targets, false);
              }}
            >
              Her yerde durdur
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
