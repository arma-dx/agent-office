import {
  customerPermissionDetails,
  type CreateProject,
  type ProjectDetail,
  type ProjectMemberCandidate,
} from '@agent-office/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { Controller, useForm, type UseFormReturn } from 'react-hook-form';
import { ContractSwitch, ProjectFields } from '@/components/projects/project-form';
import { NoticeView } from '@/components/step-up';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, userMessage } from '@/lib/api';
import { STEP_UP_TEXT } from '@/lib/passkeys';
import {
  createProjectBody,
  newProjectValues,
  NO_CUSTOMER,
  projectFormSchema,
  type ProjectFormValues,
} from '@/lib/projects/form';
import { sortedByName } from '@/lib/projects/labels';
import {
  createProject,
  customersQueryOptions,
  memberCandidatesQueryOptions,
  projectKey,
  projectsKey,
} from '@/lib/projects/query';
import { companyLabel, useCompany, useSession } from '@/lib/session';
import { useStepUp } from '@/lib/step-up';
import { busyProps } from '@/lib/utils';

const HELP = 'text-sm text-ink-secondary';

/** An answer of the API that the form itself deals with, instead of showing it as it is. */
const FORM_REFUSALS = ['customer_exists', 'customer_not_found', 'member_not_allowed'] as const;
function isFormRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && FORM_REFUSALS.some((code) => code === error.code);
}

/**
 * The members of a new project: one checkbox per founder and employee of the company. The opener
 * is always a member (the database makes them one), so their row is checked and cannot be
 * changed; it stays focusable, like every fixed control of the panel, and the help text says why.
 */
function MemberFields({
  form,
  candidates,
}: {
  form: UseFormReturn<ProjectFormValues>;
  candidates: { people: readonly ProjectMemberCandidate[]; loading: boolean; failed: boolean };
}) {
  const session = useSession();
  const id = useId();
  const error = form.formState.errors.memberIds?.message;
  const others = sortedByName(candidates.people).filter(
    (person) => person.userId !== session.user.id,
  );
  const row = 'flex items-center gap-2 text-sm';
  const box = 'size-4 accent-(--brand)';
  return (
    <fieldset aria-describedby={`${id}-help`} className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Üyeler</legend>
      <label className={row}>
        <input
          type="checkbox"
          className={box}
          checked
          aria-disabled="true"
          onChange={() => {
            // The opener is a member: the box does not change.
          }}
        />
        {session.user.name} (siz)
      </label>
      <Controller
        control={form.control}
        name="memberIds"
        render={({ field }) => (
          <>
            {others.map((person) => (
              <label key={person.userId} className={row}>
                <input
                  type="checkbox"
                  className={box}
                  checked={field.value.includes(person.userId)}
                  onChange={(event) => {
                    field.onChange(
                      event.target.checked
                        ? [...field.value, person.userId]
                        : field.value.filter((userId) => userId !== person.userId),
                    );
                  }}
                />
                {person.name}
              </label>
            ))}
          </>
        )}
      />
      {candidates.loading ? <p className={HELP}>Kişiler yükleniyor.</p> : null}
      {candidates.failed ? (
        <p role="alert" className="text-sm text-destructive">
          Kişi listesi alınamadı. Üyeleri sonra proje sayfasından ekleyebilirsiniz.
        </p>
      ) : null}
      {error !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p id={`${id}-help`} className={HELP}>
        Projeyi ve ona bağlı kayıtları yalnızca üyeler ve kurucu görür. Projeyi açan kişi üyedir.
        Projeyi açan kişi projenin sahibi olur.
      </p>
    </fieldset>
  );
}

/**
 * The second view of the dialog: the founder marked the contract of a new customer as allowing AI,
 * and confirms that with a passkey (8 October 2026, decisions 16 and 22). The project and the
 * customer are created by the confirmed request and not before. The re-verification names the new
 * customer's id, its name and the automated processing permission exactly as the request carries
 * them.
 */
function PasskeyStep({
  body,
  customer,
  onBack,
  onCreated,
  onRefused,
  onBusyChange,
}: {
  body: CreateProject;
  customer: { id: string; name: string; automatedProcessingAllowed: boolean };
  onBack: () => void;
  onCreated: (project: ProjectDetail) => void;
  /** The API refused something the form deals with: back to the form, which says it. */
  onRefused: (error: ApiError) => void;
  /** Tells the dialog whether the ceremony or the request is on its way. */
  onBusyChange: (busy: boolean) => void;
}) {
  const company = useCompany();
  const title = useRef<HTMLHeadingElement>(null);
  // The view replaced the button that had the focus: its title takes it, once.
  useEffect(() => {
    title.current?.focus();
  }, []);
  const stepUp = useStepUp<ProjectDetail | ApiError>({
    request: {
      purpose: 'customer_ai_permission',
      companyId: company.companyId,
      subjectId: customer.id,
      details: customerPermissionDetails({
        name: customer.name,
        automatedProcessingAllowed: customer.automatedProcessingAllowed,
      }),
    },
    action: (signed) =>
      createProject(company.companyId, { ...body, stepUp: signed }).catch((error: unknown) => {
        // Handed back as a value: the form says it, and this view goes away.
        if (isFormRefusal(error)) return error;
        throw error;
      }),
    onSuccess: (result) => {
      if (result instanceof ApiError) onRefused(result);
      else onCreated(result);
    },
  });
  // The dialog reads this when Escape is pressed: nothing leaves the view while it is busy.
  const busy = stepUp.busy;
  useEffect(() => {
    onBusyChange(busy);
    return () => {
      onBusyChange(false);
    };
  }, [busy, onBusyChange]);
  return (
    <>
      <DialogTitle ref={title} tabIndex={-1}>
        Müşterinin yapay zekâ izni açılsın mı?
      </DialogTitle>
      <DialogDescription>
        {customer.name} için sözleşmenin yapay zekâ kullanımına izin verdiğini işaretlediniz. Proje
        ve müşteri, passkey ile onayladığınızda oluşturulur.
      </DialogDescription>
      <p className="text-sm">{STEP_UP_TEXT.hint}</p>
      <NoticeView notice={stepUp.notice} />
      {stepUp.notice?.link === 'security' ? (
        <p className={HELP}>
          Güvenlik sayfasına giderseniz bu form kapanır. Geri ile dönüp izni kapalı bırakarak
          projeyi şimdi oluşturabilirsiniz.
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          {...busyProps(stepUp.busy)}
          onClick={() => {
            if (!stepUp.busy) onBack();
          }}
        >
          Geri
        </Button>
        <Button
          type="button"
          size="lg"
          {...busyProps(stepUp.busy || !stepUp.ready)}
          onClick={() => {
            stepUp.confirm();
          }}
        >
          Onayla ve oluştur
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * "Yeni proje" (8 October 2026, decisions 15 to 17): a founder or an employee opens a project in
 * the selected company and is its member. The customer is optional: none, one of the company's by
 * name, or a new one by name. For a customer the founder adds here, the two contract permissions
 * can be marked; an employee's new customer starts with both closed.
 *
 * The AI permission of the project is in this dialog for nobody: a project starts without it, and
 * the founder opens it on the project page with a passkey.
 *
 * Nothing is shown as created before the API has stored it; the project page is the confirmation.
 * The ids of the project and of a new customer are made once when the dialog opens, so a send that
 * is repeated opens nothing a second time.
 */
export function NewProjectDialog({
  onClose,
  onCloseAutoFocus,
}: {
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isFounder = company.role === 'founder';
  const [ids] = useState(() => ({
    projectId: crypto.randomUUID(),
    customerId: crypto.randomUUID(),
  }));
  // The form does not wait for the two lists.
  const customers = useQuery(customersQueryOptions(company.companyId));
  const candidates = useQuery(memberCandidatesQueryOptions(company.companyId));
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: newProjectValues(),
  });
  // The body that waits for the founder's passkey; null while the form is on screen.
  const [confirming, setConfirming] = useState<CreateProject | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const stepBusy = useRef(false);
  const setStepBusy = useCallback((busy: boolean) => {
    stepBusy.current = busy;
  }, []);
  // Set when the passkey view gives way to the form again, with the refusal that sent it back.
  const [returned, setReturned] = useState<{ refusal: ApiError | null } | null>(null);
  // The project exists: the focus goes with the person to its page, not back to the button.
  const created = useRef(false);

  function opened(project: ProjectDetail) {
    created.current = true;
    queryClient.setQueryData(projectKey(company.companyId, project.id), project);
    void queryClient.invalidateQueries({ queryKey: projectsKey(company.companyId) });
    onClose();
    void navigate({
      to: '/c/$company/projects/$projectId',
      params: { company: company.code, projectId: project.id },
    });
  }

  /**
   * An answer that says a list the person chose from is stale, or that the customer's name is
   * taken. The person cannot refresh a list inside a dialog, so the panel reads it again itself
   * and takes back the choice that is gone.
   */
  async function refused(error: ApiError): Promise<void> {
    if (error.code === 'customer_exists') {
      form.setError('customerName', { message: error.message }, { shouldFocus: true });
      void queryClient.invalidateQueries(customersQueryOptions(company.companyId));
    } else if (error.code === 'customer_not_found') {
      const fresh = await customers.refetch();
      const chosen = form.getValues('customerChoice');
      if (!(fresh.data ?? []).some((customer) => customer.id === chosen)) {
        form.setValue('customerChoice', NO_CUSTOMER);
      }
    } else if (error.code === 'member_not_allowed') {
      const fresh = await candidates.refetch();
      const offered = new Set((fresh.data ?? []).map((person) => person.userId));
      form.setValue(
        'memberIds',
        form.getValues('memberIds').filter((userId) => offered.has(userId)),
      );
    }
  }

  const send = useMutation({
    mutationFn: (body: CreateProject) => createProject(company.companyId, body),
    onSuccess: opened,
    onError: (error) => {
      if (isFormRefusal(error)) void refused(error);
    },
  });
  // Back on the form after the passkey view: the form is on screen again, so a field can take the
  // focus. A refusal is dealt with here; otherwise the button that led to the passkey takes it.
  const onReturned = useEffectEvent((refusal: ApiError | null) => {
    if (refusal) void refused(refusal);
    if (refusal?.code !== 'customer_exists') submitButton.current?.focus();
  });
  useEffect(() => {
    if (returned !== null) onReturned(returned.refusal);
  }, [returned]);
  // The name's own sentence stands under the name; every other refusal above the footer.
  const refusal = send.error ?? returned?.refusal ?? null;
  const general =
    refusal !== null && !(refusal instanceof ApiError && refusal.code === 'customer_exists')
      ? refusal
      : null;

  const submit = form.handleSubmit((values) => {
    if (send.isPending) return;
    const body = createProjectBody(values, ids);
    send.reset();
    setReturned(null);
    // Only the founder has the switch; the API refuses the permission from anybody else.
    if (body.customer?.kind === 'new' && body.customer.aiAllowed === true) {
      setConfirming(body);
      return;
    }
    send.mutate(body);
  });

  function backToForm(refusal: ApiError | null = null) {
    setConfirming(null);
    setReturned({ refusal });
  }

  const newCustomer = confirming?.customer?.kind === 'new' ? confirming.customer : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !send.isPending && !stepBusy.current) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl"
        // A slip of the pointer beside the dialog would lose the form.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          // On the passkey view Escape goes back to the form and never closes the dialog: a
          // filled form is not lost by the key a person presses to back out of a passkey prompt.
          if (confirming !== null) {
            event.preventDefault();
            if (!stepBusy.current) backToForm();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          form.setFocus('name');
        }}
        onCloseAutoFocus={(event) => {
          if (created.current) event.preventDefault();
          else onCloseAutoFocus(event);
        }}
      >
        {confirming !== null && newCustomer ? (
          <>
            <PasskeyStep
              body={confirming}
              customer={{
                id: newCustomer.id,
                name: newCustomer.name,
                automatedProcessingAllowed: newCustomer.automatedProcessingAllowed === true,
              }}
              onBusyChange={setStepBusy}
              onBack={() => {
                backToForm();
              }}
              onCreated={opened}
              onRefused={backToForm}
            />
          </>
        ) : (
          <>
            <DialogTitle>Yeni proje</DialogTitle>
            <DialogDescription>{companyLabel(company)} için açılır.</DialogDescription>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => void submit(event)}
              noValidate
            >
              <ProjectFields
                form={form}
                customers={{ list: customers.data ?? [], failed: customers.isError }}
                customerNote={({ isNew, existing }) =>
                  isNew ? (
                    isFounder ? (
                      <>
                        <ContractSwitch
                          form={form}
                          name="customerAiAllowed"
                          label="Sözleşme yapay zekâ kullanımına izin veriyor"
                          help="Açarsanız projeyi passkey ile onaylayarak oluşturursunuz. Kapalıyken bu müşterinin projelerinde ajanlar çalışamaz."
                        />
                        <ContractSwitch
                          form={form}
                          name="customerAutomatedAllowed"
                          label="Sözleşme kodla otomatik işlemeye izin veriyor"
                          help="Kapalıyken hatırlatma gibi model kullanmayan otomatik işler de bu müşteri için durur."
                        />
                      </>
                    ) : (
                      <p className={HELP}>
                        Yeni müşterinin sözleşme izinleri kapalı başlar. İzinleri kurucu işaretler.
                      </p>
                    )
                  ) : existing !== null &&
                    existing.aiAllowed !== null &&
                    existing.automatedProcessingAllowed !== null ? (
                    // Only the founder is told the permissions (the API gives an employee names).
                    <p className={HELP}>
                      Sözleşme izinleri: yapay zekâ kullanımı{' '}
                      {existing.aiAllowed ? 'açık' : 'kapalı'}, kodla otomatik işleme{' '}
                      {existing.automatedProcessingAllowed ? 'açık' : 'kapalı'}. İzinleri proje
                      sayfasından değiştirebilirsiniz.
                    </p>
                  ) : null
                }
                afterCustomer={
                  <MemberFields
                    form={form}
                    candidates={{
                      people: candidates.data ?? [],
                      loading: candidates.isPending,
                      failed: candidates.isError,
                    }}
                  />
                }
              />
              <p className={HELP}>
                Yapay zekâ izni kapalı başlar; izin açılana kadar bu projede ajanlar çalışamaz. İzni
                kurucu, proje sayfasından passkey ile açar.
              </p>
              {general !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {userMessage(general)}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  {...busyProps(send.isPending)}
                  onClick={() => {
                    if (!send.isPending) onClose();
                  }}
                >
                  Vazgeç
                </Button>
                <Button ref={submitButton} type="submit" size="lg" {...busyProps(send.isPending)}>
                  {send.isPending ? 'Oluşturuluyor' : 'Projeyi oluştur'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
