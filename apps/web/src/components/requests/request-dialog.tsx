import {
  PROJECT_NAME_MAX,
  REQUEST_TEXT_MAX,
  requestDueDateSchema,
  type CreateRequest,
} from '@agent-office/shared';
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
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, userMessage } from '@/lib/api';
import { officeToday } from '@/lib/dates';
import { draftKey, readDraft, saveDraft, saveDraftSoon } from '@/lib/drafts';
import { useReturnFocus } from '@/lib/focus';
import { projectsKey, projectsQueryOptions } from '@/lib/projects/query';
import { RequestDialogContext, type RequestProject } from '@/lib/requests/dialog';
import { INTAKE_FOR_FOUNDER, INTAKE_SENTENCE } from '@/lib/requests/labels';
import { projectOptions } from '@/lib/requests/project-options';
import { createRequest, requestIntakeQueryOptions, requestKey } from '@/lib/requests/query';
import { useCompany, useSession } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * "Yeni talep": the form of flow (A). It asks what is wanted and, if the person wishes, a project
 * and a due day (information only: docs/SONRA.md W-h). No title, no unit, no agent and no
 * approver: the coordination centre routes the request (7 October decision 1). Opened from the
 * first row of the sidebar, from the Talepler screen and, with the project chosen, from a
 * project's page; one dialog for the shell.
 *
 * The project (8 October decisions 11 and 17): the form offers the open projects the person may
 * read. A project where agents may not work (rule 12) is offered disabled with the reason in its
 * label, so that nobody takes its absence for a mistake and sends the request without a project,
 * where the whole company reads it; a closed project is not offered. The sentence under the form
 * says who will read the request, and changes with the choice. A chosen project that is no longer
 * offered is said at the field and nothing is sent: the project of a request never changes.
 *
 * Nothing is shown as sent before the API has stored it. A send that is repeated carries the same
 * id, so a request is never opened twice. The text, the project and the due day are kept as a
 * draft in the tab until they are sent or discarded.
 *
 * A send whose answer was lost may have been stored all the same; the form stays open and can be
 * changed before the next try. The API then answers the first record, and neither the text, the
 * project nor the due day of a sent request can be corrected: when the answer is not what was
 * sent, a notice that stays until it is closed says that the change was not taken.
 *
 * The due day cannot be changed after the send, so the form never lets one go that the person did
 * not mean: a day before today and a date that is only half typed are said at the field and
 * nothing is sent, and plain Enter in the date field sends nothing (as in the text box, only Ctrl
 * or Command with Enter sends).
 *
 * When it opens, the form asks whether a request can run for this person here now (the
 * coordinator open and ready; its card is active, so for every founder and employee, and were it
 * put on trial, for the founder only). If not, it says why and does not send: nobody writes a
 * request that would die at the door.
 */

// A draft written before the form had a due day or a project carries none, and a day or a project
// that cannot be read is dropped: neither takes the text with it.
const draftSchema = z.object({
  id: z.uuid(),
  text: z.string().max(REQUEST_TEXT_MAX),
  dueDate: z.union([requestDueDateSchema, z.literal('')]).catch(''),
  // The name is kept beside the id, so that the field can show what is chosen before the list of
  // projects has been read, and when it could not be read.
  project: z
    .object({ id: z.uuid(), name: z.string().max(PROJECT_NAME_MAX) })
    .nullable()
    .catch(null),
});

/** The API's refusals that say the chosen project takes no request (any more). */
const PROJECT_REFUSALS: readonly (string | undefined)[] = [
  'project_not_available',
  'project_closed',
  'project_ai_not_allowed',
];

const WHO_READS = {
  company:
    'Talep metni yapay zekâ modeline gönderilir. Talebi ve onaylanan sonucunu şirketteki kurucu ve çalışanlar görebilir.',
  project:
    'Talep metni yapay zekâ modeline gönderilir. Talebi ve onaylanan sonucunu yalnızca bu projenin üyeleri ve kurucu görebilir.',
};

const FIRST_RECORD_KEPT =
  'Talep ilk gönderdiğiniz hâliyle kayıtlı; sonradan yaptığınız değişiklik alınmadı. Değiştirmek için bu talebi iptal edip yenisini gönderin.';

/** What the date field holds is a real calendar day (the contract of the API). */
function isDay(value: string): boolean {
  return requestDueDateSchema.safeParse(value).success;
}

export function RequestDialogProvider({ children }: { children: ReactNode }) {
  const company = useCompany();
  // Shown while not null; `preset` is the project the form opens with (a project's page).
  const [shown, setShown] = useState<{ preset: RequestProject | null } | null>(null);
  const focus = useReturnFocus();
  const remember = focus.remember;
  const open = useCallback(() => {
    // The button that opened the form takes the focus back when it closes.
    remember();
    setShown({ preset: null });
  }, [remember]);
  const openFor = useCallback(
    (project: RequestProject) => {
      remember();
      setShown({ preset: project });
    },
    [remember],
  );
  const openers = useMemo(() => ({ open, openFor }), [open, openFor]);
  // A request is opened by the founder and employees, in a company (not in Kurucu alanı).
  const offered = company.role !== 'external' && company.kind === 'company';
  return (
    <RequestDialogContext value={offered ? openers : null}>
      {children}
      {offered && shown ? (
        <RequestDialog
          preset={shown.preset}
          onClose={() => {
            setShown(null);
          }}
          onCloseAutoFocus={focus.onCloseAutoFocus}
        />
      ) : null}
    </RequestDialogContext>
  );
}

function RequestDialog({
  preset,
  onClose,
  onCloseAutoFocus,
}: {
  /** The project the form opens with; it wins over the project of a draft, whose text is kept. */
  preset: RequestProject | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = draftKey(session.user.id, company.companyId, 'request');
  const initial = useMemo(
    () =>
      readDraft(key, draftSchema) ?? {
        id: crypto.randomUUID(),
        text: '',
        dueDate: '',
        project: null,
      },
    [key],
  );
  const [text, setText] = useState(initial.text);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [project, setProject] = useState<RequestProject | null>(preset ?? initial.project);
  // The browser could not read what is in the date field (a part is missing).
  const [dueUnreadable, setDueUnreadable] = useState(false);
  // "Before today" is said once the person has left the field or tried to send, and for a day a
  // draft brought. Not while the field is being typed in: a browser reports a whole date after
  // every digit of the year, so 2026 passes through the years 0002, 0020 and 0202, and each of
  // them would be called a day that has passed.
  const [dueSettled, setDueSettled] = useState(initial.dueDate !== '');
  const [touched, setTouched] = useState(false);
  const helpId = useId();
  const noticeId = useId();
  const errorId = useId();
  const closedId = useId();
  const projectId = useId();
  const textBox = useRef<HTMLTextAreaElement>(null);
  const dueBox = useRef<HTMLInputElement>(null);
  // The earliest day the field offers; the checks below ask the clock again when they are made.
  const today = useMemo(() => officeToday(), []);
  const intake = useQuery(requestIntakeQueryOptions(company.companyId));
  // Unknown (still asking, or the question failed) does not block: the API decides at the send.
  const closedBecause = intake.data && !intake.data.open ? intake.data.reason : null;
  // Read anew for every opening: whether a project takes a request changes with its status and
  // with the two permissions of rule 12.
  const projects = useQuery({ ...projectsQueryOptions(company.companyId), staleTime: 0 });
  const options = projects.data ? projectOptions(projects.data.projects) : [];
  const chosen =
    project === null ? null : (options.find((option) => option.id === project.id) ?? null);
  // The chosen project (a draft's, a preset, or one chosen before the list was read again) is no
  // longer offered, or agents may not work in it any more.
  const gone = project !== null && projects.isSuccess && (chosen === null || chosen.disabled);
  // A project is chosen and the list that says whether it takes a request is still on its way.
  const projectUnknown = project !== null && projects.isPending;
  const founder = company.role === 'founder';
  // An offered project cannot be chosen: the form says why, and who can change that.
  const disabledOffered = options.some((option) => option.disabled);

  const send = useMutation({
    mutationFn: (sent: CreateRequest) => createRequest(company.companyId, sent),
    onSuccess: (detail, sent) => {
      saveDraft(key, null);
      // The id was stored by an earlier try whose answer was lost, and the form was changed
      // since: the record holds the first text, project and day. Said, never dropped in silence:
      // the project decides who reads the request.
      if (
        detail.text !== sent.text ||
        detail.dueDate !== (sent.dueDate ?? null) ||
        (detail.project?.id ?? null) !== (sent.projectId ?? null)
      ) {
        toast.warning(FIRST_RECORD_KEPT, { duration: Infinity, closeButton: true });
      }
      queryClient.setQueryData(requestKey(company.companyId, detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: ['company', company.companyId, 'requests'] });
      onClose();
      // The page is the confirmation: it says "Yönlendiriliyor".
      void navigate({
        to: '/c/$company/requests/$requestId',
        params: { company: company.code, requestId: detail.id },
      });
    },
    onError: (error) => {
      // The project stopped taking requests between the list and the send: the list is read
      // again, and the field then says so itself. The text and the draft stay.
      if (error instanceof ApiError && PROJECT_REFUSALS.includes(error.code)) {
        void queryClient.invalidateQueries({ queryKey: projectsKey(company.companyId) });
      }
    },
  });

  /** Every change of the form is kept: the text, the due day and the project together. */
  function keep(
    changed: Partial<{ text: string; dueDate: string; project: RequestProject | null }>,
  ): void {
    saveDraftSoon(key, { id: initial.id, text, dueDate, project, ...changed });
  }

  const empty = text.trim() === '';
  const tooLong = text.length > REQUEST_TEXT_MAX;
  const problem = tooLong
    ? 'Talep en çok 20.000 karakter olabilir.'
    : touched && empty
      ? 'Ne istediğinizi yazın.'
      : null;
  // Said before a send too: when the field is left, and when the form opens with a draft from
  // yesterday that carries yesterday's day.
  const dueProblem =
    dueUnreadable || (dueDate !== '' && !isDay(dueDate))
      ? 'Geçerli bir tarih seçin.'
      : dueSettled && dueDate !== '' && dueDate < officeToday()
        ? 'Son tarih bugünden önce olamaz.'
        : null;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    setTouched(true);
    setDueSettled(true);
    // A date field with a part missing has no value, and the browser fires no change event while
    // the value stays empty: the field itself is asked before anything is sent. Without this the
    // request would leave without the day the person was typing, for good.
    const unreadable = dueBox.current?.validity.badInput === true;
    setDueUnreadable(unreadable);
    if (unreadable) return;
    if (dueDate !== '' && (!isDay(dueDate) || dueDate < officeToday())) return;
    if (empty || tooLong || send.isPending || closedBecause !== null) return;
    // Not into a project that takes no request, and not before the list has said whether it does.
    // When the list could not be read the request is sent: the API decides.
    if (gone || projectUnknown) return;
    // A request without a due day or without a project sends no key for it.
    send.mutate({
      id: initial.id,
      text,
      ...(dueDate === '' ? {} : { dueDate }),
      ...(project === null ? {} : { projectId: project.id }),
    });
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
                keep({ text: event.target.value });
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
          {/* Always drawn, so that the form does not jump when the list arrives. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={projectId} className="text-sm font-medium">
              Proje
            </label>
            <NativeSelect
              id={projectId}
              value={project?.id ?? ''}
              disabled={projects.isPending}
              aria-busy={projects.isPending}
              aria-invalid={gone}
              aria-describedby={[
                `${projectId}-help`,
                disabledOffered ? `${projectId}-closed` : null,
                gone ? `${projectId}-problem` : null,
              ]
                .filter(Boolean)
                .join(' ')}
              onChange={(event) => {
                const picked = options.find((option) => option.id === event.target.value);
                const next = picked ? { id: picked.id, name: picked.name } : null;
                setProject(next);
                keep({ project: next });
              }}
            >
              {projects.isPending ? (
                <option id={`${projectId}-reading`} value="">
                  Projeler okunuyor
                </option>
              ) : (
                <>
                  <option value="">Proje yok</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id} disabled={option.disabled}>
                      {option.label}
                    </option>
                  ))}
                </>
              )}
              {/* What is chosen and not in the list (the list is on its way, could not be read,
                  or no longer offers it): the select still shows it, by its own name. */}
              {project !== null && chosen === null ? (
                <option value={project.id}>{project.name}</option>
              ) : null}
            </NativeSelect>
            {gone ? (
              <p id={`${projectId}-problem`} role="alert" className="text-sm text-destructive">
                Bu projede artık talep açılamıyor. Başka bir proje ya da &quot;Proje yok&quot;
                seçin.
              </p>
            ) : null}
            {projects.isError ? (
              <div role="alert" className="flex flex-col items-start gap-1.5 text-sm">
                <p>
                  Proje listesi alınamadı. Talebi projesiz gönderebilir ya da listeyi yeniden
                  okuyabilirsiniz.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  {...busyProps(projects.isFetching)}
                  onClick={() => {
                    if (!projects.isFetching) void projects.refetch();
                  }}
                >
                  Yeniden dene
                </Button>
              </div>
            ) : null}
            <p id={`${projectId}-help`} className="text-sm text-ink-secondary">
              {projects.isSuccess && options.length === 0
                ? founder
                  ? 'Bu şirkette açık proje yok.'
                  : 'Üyesi olduğunuz açık proje yok.'
                : 'İsteğe bağlı. Proje seçerseniz talebi yalnızca o projenin üyeleri ve kurucu görür, ajanlar da o projenin içinde çalışır. Proje, talep gönderildikten sonra değiştirilemez.'}
            </p>
            {disabledOffered ? (
              <p id={`${projectId}-closed`} className="text-sm text-ink-secondary">
                Ajanların çalışamadığı projede talep açılamaz.{' '}
                {founder
                  ? 'Yapay zekâ iznini projenin sayfasından açabilirsiniz.'
                  : 'Yapay zekâ iznini kurucu açar.'}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${helpId}-due`} className="text-sm font-medium">
              Son tarih (isteğe bağlı)
            </label>
            <Input
              id={`${helpId}-due`}
              ref={dueBox}
              type="date"
              className="w-44"
              min={today}
              value={dueDate}
              aria-invalid={dueProblem !== null}
              aria-describedby={
                dueProblem ? `${helpId}-due-help ${helpId}-due-error` : `${helpId}-due-help`
              }
              onChange={(event) => {
                setDueDate(event.target.value);
                setDueSettled(false);
                // A date typed half way has no value; the browser says so here.
                setDueUnreadable(event.target.validity.badInput);
                keep({ dueDate: event.target.value });
              }}
              onBlur={(event) => {
                setDueSettled(true);
                setDueUnreadable(event.target.validity.badInput);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Plain Enter would send the form (the browser's implicit submit).
                if (event.metaKey || event.ctrlKey) submit(event);
                else event.preventDefault();
              }}
            />
            {dueProblem ? (
              <p id={`${helpId}-due-error`} role="alert" className="text-sm text-destructive">
                {dueProblem}
              </p>
            ) : null}
            <p id={`${helpId}-due-help`} className="text-sm text-ink-secondary">
              Yalnızca bilgidir: talebi görenler ve ajanlar görür. Gönderdikten sonra
              değiştirilemez; günü geçince hatırlatma gönderilmez.
            </p>
          </div>
          {/* Who will read the request follows the choice of a project, and the change is said. */}
          <p id={noticeId} aria-live="polite" className="text-sm text-ink-secondary">
            {project === null ? WHO_READS.company : WHO_READS.project}
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
              {...busyProps(send.isPending || closedBecause !== null || gone || projectUnknown)}
              aria-describedby={
                closedBecause !== null
                  ? closedId
                  : gone
                    ? `${projectId}-problem`
                    : projectUnknown
                      ? `${projectId}-reading`
                      : undefined
              }
            >
              {send.isPending ? 'Gönderiliyor' : 'Talebi gönder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
