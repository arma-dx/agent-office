import {
  loosensSpendingLimit,
  normalizeUsdLimit,
  projectAiSpendingLimitDetails,
  spendingState,
  type ProjectAiSpendingLimitAnswer,
  type ProjectDetail,
} from '@agent-office/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { StepUpDialog } from '@/components/step-up';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, userMessage } from '@/lib/api';
import { waitingState, waitingWorkQueryOptions } from '@/lib/office/query';
import { limitFormSchema, limitOf, type LimitFormValues } from '@/lib/projects/form';
import {
  amountInputText,
  formatMoney,
  limitAlreadyReached,
  remainingUsd,
} from '@/lib/projects/money';
import { projectKey, projectRunsKey, setProjectAiSpendingLimit } from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { limitWaitingWorkSentence, restartedSentence } from '@/lib/requests/labels';
import { approvalDeskKey } from '@/lib/requests/query';
import { useCompany } from '@/lib/session';
import { sidebarCountsKey, todayKey } from '@/lib/today/query';
import { busyProps, cn } from '@/lib/utils';

type Spending = NonNullable<ProjectDetail['aiSpending']>;

const LABEL = 'text-sm font-medium';
const HELP = 'text-sm text-ink-secondary';
const PROBLEM = 'text-sm text-destructive';

/** Where the spending stands against the limit, in words; the tone only repeats the words. */
const STATE = {
  no_limit: { text: 'Bu projede harcama sınırı yok.', tone: 'text-ink-secondary' },
  ok: { text: 'Harcama, sınırın altında.', tone: 'text-ink-secondary' },
  // The two text tones of the status language (index.css): never a colour alone.
  near: { text: "Harcama, sınırın yüzde 80'ine ulaştı.", tone: 'text-status-open-text' },
  reached: {
    text: 'Harcama sınırı doldu: ajanlar bu projede yeni çalışma başlatmıyor.',
    tone: 'text-status-error-text',
  },
} as const;

/** The answer of a change of the limit: the project, which the page keeps, and what restarted. */
function split({ restarted, ...project }: ProjectAiSpendingLimitAnswer): {
  project: ProjectDetail;
  restarted: number;
} {
  return { project, restarted };
}

/**
 * The form of the limit. "Kaydet" with a first limit or a lower one sends at once: that only
 * stops agents earlier. A higher limit and "Sınırı kaldır" let agents spend more, so they are
 * handed on (`onLoosen`) to the confirmation that asks for the passkey; nothing is sent here.
 * The line under the field warns while the typed limit is not above what was spent: saved, it is
 * reached at once.
 */
function LimitDialog({
  project,
  spending,
  onClose,
  onLoosen,
  onStored,
  onCloseAutoFocus,
}: {
  project: ProjectDetail;
  spending: Spending;
  onClose: () => void;
  /** The limit the person asks for needs the passkey; null: the limit is taken away. */
  onLoosen: (next: string | null) => void;
  onStored: (answer: ProjectAiSpendingLimitAnswer, next: string | null) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const id = useId();
  // The limit the form was filled from.
  const [opened] = useState(spending.limitUsd);
  const form = useForm<LimitFormValues>({
    resolver: zodResolver(limitFormSchema),
    defaultValues: { limit: opened === null ? '' : amountInputText(opened) },
  });
  const error = form.formState.errors.limit;
  const typed = limitOf(useWatch({ control: form.control, name: 'limit' }));
  const reachedAtOnce = typed !== null && limitAlreadyReached(typed, spending.spentUsd);

  const save = useMutation({
    mutationFn: (next: string) =>
      setProjectAiSpendingLimit(company.companyId, project.id, { limitUsd: next }),
    onSuccess: onStored,
    onError: (refusal) => {
      // The limit was lowered elsewhere meanwhile: what was a first or a lower limit is a raise
      // now. The page reads the project again and the person starts from the limit as it is.
      if (refusal instanceof ApiError && refusal.code === 'step_up_required') {
        void queryClient.invalidateQueries({
          queryKey: projectKey(company.companyId, project.id),
        });
        toast.error('Sınır az önce değişti. Yeniden deneyin.');
        onClose();
      }
    },
  });

  const submit = form.handleSubmit((values) => {
    if (save.isPending) return;
    const parsed = limitOf(values.limit);
    if (parsed === null) return;
    const next = normalizeUsdLimit(parsed);
    // Against the limit the page shows now, which may be newer than the one the form opened with.
    if (loosensSpendingLimit(spending.limitUsd, next)) onLoosen(next);
    else save.mutate(next);
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        // A slip of the pointer beside the dialog would lose what was typed.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          form.setFocus('limit');
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>Yapay zekâ harcama sınırı</DialogTitle>
        <DialogDescription>
          Bu projedeki ajan çalışmalarının kayıtlı maliyeti bu tutara ulaşınca ajanlar bu projede
          durur: yeni çalışma başlamaz, süren çalışma bir sonraki adımında biter. Sınır projenin
          bütün ömrü için geçerlidir.
        </DialogDescription>
        <p className="text-sm tabular-nums">
          Şimdiye kadar harcanan: {formatMoney(spending.spentUsd, 'USD')}.
        </p>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-limit`} className={LABEL}>
              Sınır (ABD doları)
            </label>
            <Input
              id={`${id}-limit`}
              inputMode="decimal"
              autoComplete="off"
              className="w-56 tabular-nums"
              aria-required="true"
              aria-invalid={error !== undefined}
              aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
              {...form.register('limit')}
            />
            {error ? (
              <p id={`${id}-error`} role="alert" className={PROBLEM}>
                {error.message}
              </p>
            ) : null}
            <p id={`${id}-help`} className={HELP}>
              Örnek: 25,00
            </p>
            {/* A live region that is always in the dialog, so that its sentence is read when the
                typed value falls to or below what was spent; empty, it takes back the gap. */}
            <p role="status" className="text-sm text-status-open-text empty:-mt-1.5">
              {reachedAtOnce
                ? 'Bu tutar şimdiye kadar harcanandan büyük değil: kaydedince ajanlar bu projede hemen durur.'
                : null}
            </p>
          </div>
          {save.isError ? (
            <p role="alert" className={PROBLEM}>
              {userMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            {spending.limitUsd !== null ? (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                {...busyProps(save.isPending)}
                onClick={() => {
                  if (!save.isPending) onLoosen(null);
                }}
              >
                Sınırı kaldır
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              {...busyProps(save.isPending)}
              onClick={() => {
                if (!save.isPending) onClose();
              }}
            >
              Vazgeç
            </Button>
            <Button type="submit" size="lg" {...busyProps(save.isPending)}>
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What is open: the form, or the confirmation of a limit that needs the passkey. */
type Asked = { kind: 'form' } | { kind: 'passkey'; next: string | null; from: string };

/**
 * The founder's block at the top of the "Çalışmalar" tab (8 October 2026, decision 17): what the
 * project's agents have spent, the limit, what is left, and one sentence that says where the
 * spending stands. Drawn only when the API's answer carries the figures, which it does for the
 * founder alone (docs/SONRA.md P-t): a member sees no block, and learns from the banner above the
 * tabs that the limit is reached and nothing more.
 *
 * Setting a first limit and lowering one only stop agents earlier and are sent at once. Raising
 * the limit and taking it away let agents spend more: they ask for a passkey bound to this
 * project and to the new value (docs/SONRA.md P3-m), and they start the work the limit held again
 * (11 October decision 1). So the confirmation says how many requests will start before the
 * passkey is asked for: the number is the database's, read for the limit that is being
 * confirmed, and the confirm button waits for it; a count that could not be read does not block
 * the change. Afterwards a toast says how many really started.
 *
 * No bar and no percentage that moves: one fixed sentence from 80 percent on. The state is said
 * in words; the tone of the line only repeats them.
 */
export function SpendingLimit({ project }: { project: ProjectDetail }) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const headingId = useId();
  const [asked, setAsked] = useState<Asked | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // The form hands on to the confirmation, which takes the focus itself: the closing form must
  // not pull it back to the block's button first.
  const handingOn = useRef(false);
  const passkey = asked?.kind === 'passkey' ? asked : null;

  // How many requests the limit that is being confirmed would start. Read only while such a
  // confirmation is open, and anew for each.
  const waiting = useQuery({
    ...waitingWorkQueryOptions(
      company.companyId,
      passkey?.next == null
        ? { spendingLimit: project.id }
        : { spendingLimit: project.id, limitUsd: passkey.next },
    ),
    enabled: passkey !== null,
  });

  const spending = project.aiSpending;
  if (spending === null) return null;

  const close = () => {
    setAsked(null);
  };
  const returnFocus = (event: Event) => {
    event.preventDefault();
    button.current?.focus();
  };

  // A limit that changes moves the stage of every open request of the project: held, or free
  // again. Everything that shows a request reads again, and so do the runs of the project.
  function stored(answer: ProjectAiSpendingLimitAnswer, next: string | null): void {
    const { project: updated, restarted } = split(answer);
    store(updated);
    for (const queryKey of [
      projectRunsKey(company.companyId, project.id),
      ['company', company.companyId, 'requests'],
      ['company', company.companyId, 'request'],
      todayKey(company.companyId),
      sidebarCountsKey(company.companyId),
      approvalDeskKey(company.companyId),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    // One message: what was stored and, when the change started held work again, how much.
    const saved = next === null ? 'Harcama sınırı kaldırıldı.' : 'Harcama sınırı kaydedildi.';
    toast.success(restarted > 0 ? `${saved} ${restartedSentence(restarted)}` : saved);
    close();
  }

  const state =
    STATE[spendingState(spending.limitUsd, spending.spentUsd, project.spendingLimitReached)];
  const act = passkey?.next == null ? 'remove' : 'raise';
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-line p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={headingId} className="text-[0.9375rem] font-semibold">
          Yapay zekâ harcaması
        </h3>
        {project.actions.setAiSpendingLimit ? (
          <Button
            ref={button}
            variant="outline"
            onClick={() => {
              setAsked({ kind: 'form' });
            }}
          >
            {spending.limitUsd === null ? 'Sınır belirle' : 'Sınırı değiştir'}
          </Button>
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-secondary">Harcanan</dt>
          <dd className="font-medium tabular-nums">{formatMoney(spending.spentUsd, 'USD')}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-secondary">Sınır</dt>
          <dd className="font-medium tabular-nums">
            {spending.limitUsd === null ? 'Sınır yok' : formatMoney(spending.limitUsd, 'USD')}
          </dd>
        </div>
        {spending.limitUsd === null ? null : (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-secondary">Kalan</dt>
            <dd className="font-medium tabular-nums">
              {formatMoney(remainingUsd(spending.limitUsd, spending.spentUsd), 'USD')}
            </dd>
          </div>
        )}
      </dl>
      <p role="status" className={cn('text-sm', state.tone)}>
        {state.text}
      </p>
      {/* Mounted only while open: every opening starts from the limit as it is now. */}
      {asked?.kind === 'form' ? (
        <LimitDialog
          project={project}
          spending={spending}
          onClose={close}
          onLoosen={(next) => {
            handingOn.current = true;
            setAsked({
              kind: 'passkey',
              next,
              // What the confirmation names as the limit until now.
              from: spending.limitUsd ?? '0',
            });
          }}
          onStored={stored}
          onCloseAutoFocus={(event) => {
            if (handingOn.current) {
              handingOn.current = false;
              event.preventDefault();
              return;
            }
            returnFocus(event);
          }}
        />
      ) : null}
      <StepUpDialog<ProjectAiSpendingLimitAnswer>
        open={passkey !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        request={
          passkey
            ? {
                purpose: 'project_ai_spending_limit',
                companyId: company.companyId,
                subjectId: project.id,
                details: projectAiSpendingLimitDetails(passkey.next),
              }
            : null
        }
        action={(stepUp) =>
          setProjectAiSpendingLimit(company.companyId, project.id, {
            limitUsd: passkey?.next ?? null,
            stepUp,
          })
        }
        onSuccess={(answer) => {
          stored(answer, passkey?.next ?? null);
        }}
        onCloseAutoFocus={returnFocus}
        title={
          act === 'remove' ? 'Harcama sınırı kaldırılsın mı?' : 'Harcama sınırı yükseltilsin mi?'
        }
        description={
          <>
            {passkey?.next == null
              ? 'Bu projede ajanların harcaması için sınır kalmayacak.'
              : `Sınır ${formatMoney(passkey.from, 'USD')} yerine ${formatMoney(passkey.next, 'USD')} olacak; ajanlar bu projede daha fazla harcayabilir.`}
            <span role="status" className="mt-2 block">
              {limitWaitingWorkSentence(act, waitingState(waiting))}
            </span>
          </>
        }
        confirmBlocked={waiting.isFetching}
        confirmLabel={act === 'remove' ? 'Sınırı kaldır' : 'Sınırı yükselt'}
      />
    </section>
  );
}
