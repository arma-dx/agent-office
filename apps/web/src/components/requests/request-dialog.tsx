import { REQUEST_TEXT_MAX } from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type ReactNode,
} from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { userMessage } from '@/lib/api';
import { draftKey, readDraft, saveDraft, saveDraftSoon } from '@/lib/drafts';
import { useReturnFocus } from '@/lib/focus';
import { RequestDialogContext } from '@/lib/requests/dialog';
import { INTAKE_FOR_FOUNDER, INTAKE_SENTENCE } from '@/lib/requests/labels';
import { createRequest, requestIntakeQueryOptions, requestKey } from '@/lib/requests/query';
import { useCompany, useSession } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * "Yeni talep": the form of flow (A). It asks one thing, what is wanted. No title, no unit, no
 * agent and no approver: the coordination centre routes the request (7 October decision 1).
 * Opened from the first row of the sidebar and from the Talepler screen; one dialog for the shell.
 *
 * Nothing is shown as sent before the API has stored it. A send that is repeated carries the same
 * id, so a request is never opened twice. The text is kept as a draft in the tab until it is sent
 * or discarded.
 *
 * When it opens, the form asks whether a request can run for this person here now (the
 * coordinator open and ready; a card on trial runs for the founder only). If not, it says why and
 * does not send: nobody writes a request that would die at the door.
 */

const draftSchema = z.object({ id: z.uuid(), text: z.string().max(REQUEST_TEXT_MAX) });

export function RequestDialogProvider({ children }: { children: ReactNode }) {
  const company = useCompany();
  const [open, setOpen] = useState(false);
  const focus = useReturnFocus();
  const remember = focus.remember;
  const show = useCallback(() => {
    // The button that opened the form takes the focus back when it closes.
    remember();
    setOpen(true);
  }, [remember]);
  // A request is opened by the founder and employees, in a company (not in Kurucu alanı).
  const offered = company.role !== 'external' && company.kind === 'company';
  return (
    <RequestDialogContext value={offered ? show : null}>
      {children}
      {offered && open ? (
        <RequestDialog
          onClose={() => {
            setOpen(false);
          }}
          onCloseAutoFocus={focus.onCloseAutoFocus}
        />
      ) : null}
    </RequestDialogContext>
  );
}

function RequestDialog({
  onClose,
  onCloseAutoFocus,
}: {
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = draftKey(session.user.id, company.companyId, 'request');
  const initial = useMemo(
    () => readDraft(key, draftSchema) ?? { id: crypto.randomUUID(), text: '' },
    [key],
  );
  const [text, setText] = useState(initial.text);
  const [touched, setTouched] = useState(false);
  const helpId = useId();
  const noticeId = useId();
  const errorId = useId();
  const closedId = useId();
  const textBox = useRef<HTMLTextAreaElement>(null);
  const intake = useQuery(requestIntakeQueryOptions(company.companyId));
  // Unknown (still asking, or the question failed) does not block: the API decides at the send.
  const closedBecause = intake.data && !intake.data.open ? intake.data.reason : null;

  const send = useMutation({
    mutationFn: () => createRequest(company.companyId, { id: initial.id, text }),
    onSuccess: (detail) => {
      saveDraft(key, null);
      queryClient.setQueryData(requestKey(company.companyId, detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: ['company', company.companyId, 'requests'] });
      onClose();
      // The page is the confirmation: it says "Yönlendiriliyor".
      void navigate({
        to: '/c/$company/requests/$requestId',
        params: { company: company.code, requestId: detail.id },
      });
    },
  });

  const empty = text.trim() === '';
  const tooLong = text.length > REQUEST_TEXT_MAX;
  const problem = tooLong
    ? 'Talep en çok 20.000 karakter olabilir.'
    : touched && empty
      ? 'Ne istediğinizi yazın.'
      : null;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    setTouched(true);
    if (empty || tooLong || send.isPending || closedBecause !== null) return;
    send.mutate();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !send.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl"
        onOpenAutoFocus={(event) => {
          // The text box takes the focus through the dialog, not through autoFocus: the dialog
          // then still knows where the focus was before it opened.
          event.preventDefault();
          textBox.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>Yeni talep</DialogTitle>
        <DialogDescription>{company.name} için açılır.</DialogDescription>
        {closedBecause !== null ? (
          <p id={closedId} role="alert" className="text-sm">
            {INTAKE_SENTENCE[closedBecause]}
            {company.role === 'founder' && INTAKE_FOR_FOUNDER[closedBecause]
              ? ` ${INTAKE_FOR_FOUNDER[closedBecause]}`
              : ''}
          </p>
        ) : null}
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${helpId}-text`} className="text-sm font-medium">
              Ne istiyorsunuz?
            </label>
            <Textarea
              id={`${helpId}-text`}
              ref={textBox}
              rows={6}
              className="max-h-80"
              value={text}
              aria-invalid={problem !== null}
              aria-describedby={`${helpId} ${noticeId}${problem ? ` ${errorId}` : ''}`}
              onChange={(event) => {
                setText(event.target.value);
                saveDraftSoon(key, { id: initial.id, text: event.target.value });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
              }}
            />
            {problem ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
            <p id={helpId} className="text-sm text-ink-secondary">
              İstediğiniz işi ve kullanılacak kaynak bilgiyi yazın. Birim ya da ajan seçmeniz
              gerekmez; talebi koordinasyon merkezi yönlendirir.
            </p>
          </div>
          <p id={noticeId} className="text-sm text-ink-secondary">
            Talep metni yapay zekâ modeline gönderilir. Kişisel veri ve yapay zekâ kullanımına izin
            vermeyen müşterilerin bilgisini yazmayın. Talebi ve onaylanan sonucunu şirketteki kurucu
            ve çalışanlar görebilir.
          </p>
          {send.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(send.error)}
            </p>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              {...busyProps(send.isPending)}
              onClick={() => {
                if (send.isPending) return;
                saveDraft(key, null);
                onClose();
              }}
            >
              Taslağı at
            </Button>
            <Button
              type="submit"
              size="lg"
              {...busyProps(send.isPending || closedBecause !== null)}
              aria-describedby={closedBecause !== null ? closedId : undefined}
            >
              {send.isPending ? 'Gönderiliyor' : 'Talebi gönder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
