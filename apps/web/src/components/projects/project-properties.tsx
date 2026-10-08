import {
  customerPermissionDetails,
  projectAiPermissionDetails,
  type ProjectDetail,
} from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ProjectTile } from '@/components/projects/project-tile';
import { StatusBadge } from '@/components/status';
import { StepUpDialog } from '@/components/step-up';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ApiError, userMessage } from '@/lib/api';
import { formatDay, formatFull } from '@/lib/dates';
import {
  agentsSentence,
  COLOR_NAME,
  CONTRACT_WORD,
  ICON_NAME,
  PERMISSION_WORD,
} from '@/lib/projects/labels';
import {
  customersKey,
  projectKey,
  projectPagesKey,
  projectsKey,
  setCustomerPermissions,
  setProjectAiPermission,
} from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { personName } from '@/lib/requests/labels';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

// The names take a fixed column, so every value starts at the same place.
const FIELDS = 'grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3';
const FIELD_NAME = 'text-ink-secondary';
const SECTION = 'flex flex-col gap-2';
const SECTION_HEADING = 'font-medium';
const SWITCH_ROW = 'flex items-center gap-2';

/** A change of a permission that waits for its confirmation. */
type PermissionChange =
  | 'project_on'
  | 'project_off'
  | 'customer_ai_on'
  | 'customer_ai_off'
  | 'automated_on'
  | 'automated_off';

/**
 * A confirmation without a passkey: closing any permission, and the automated processing
 * permission either way. Closing only stops agents or automatic jobs; the confirmation says what
 * stops. The safe button has the focus, and the dialog cannot be closed while its request is on
 * its way.
 */
function PlainConfirmation({
  title,
  description,
  confirmLabel,
  run,
  onClose,
  onCloseAutoFocus,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  /** Sends the change and brings the page up to date; the dialog closes when it is done. */
  run: () => Promise<unknown>;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const change = useMutation({ mutationFn: run, onSuccess: onClose });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {change.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {userMessage(change.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            autoFocus
            {...busyProps(change.isPending)}
            onClick={(event) => {
              if (change.isPending) event.preventDefault();
            }}
          >
            Vazgeç
          </AlertDialogCancel>
          <Button
            size="lg"
            {...busyProps(change.isPending)}
            onClick={() => {
              if (!change.isPending) change.mutate();
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The two permissions rule 12 reads, with the founder's switches. A switch never moves by the
 * click: the click opens a confirmation, the switch keeps showing the saved value, and the answer
 * of the API moves it. Opening an AI permission (the project's, or the customer's contract) asks
 * for a passkey bound to this project or this customer and to this act (8 October 2026, decision
 * 22); closing one, and the automated processing permission, ask plainly.
 *
 * The passkey that opens the project's permission also names the customer the page shows: rule 12
 * reads which customer a project has. If a member changed the customer meanwhile, the API refuses
 * (project_changed); the confirmation then closes, the page reads the project again and says what
 * happened, and the founder confirms anew for the customer they now see.
 *
 * A confirmation is for the customer the page showed when its switch was pressed. The page may
 * read the project again under the open confirmation (the founder comes back to the tab), and the
 * project may have another customer by then: the confirmation keeps its words, its passkey and
 * its request for the customer that was asked, and never moves to one the founder did not look at.
 * For the project's permission the API then refuses as above; a contract permission is set for
 * the customer the confirmation names.
 */
function Permissions({ project }: { project: ProjectDetail }) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const aiHeading = useId();
  const aiSentence = useId();
  const contractHeading = useId();
  // The confirmation that is open, with the customer the page showed when it was asked.
  const [asked, setAsked] = useState<{
    change: PermissionChange;
    customer: ProjectDetail['customer'];
  } | null>(null);
  // The API's sentence when the project was not what the founder confirmed.
  const [changed, setChanged] = useState<string | null>(null);
  const asker = useRef<HTMLElement | null>(null);
  // What the page shows; the confirmations below read `confirmed` instead.
  const customer = project.customer;
  const pending = asked?.change ?? null;
  const confirmed = asked?.customer ?? null;
  const confirmedId = confirmed?.id ?? null;

  function ask(change: PermissionChange, control: HTMLElement) {
    asker.current = control;
    setChanged(null);
    setAsked({ change, customer: project.customer });
  }
  const close = () => {
    setAsked(null);
  };
  // The confirmations have no trigger of their own: the focus goes back to the switch by hand.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    asker.current?.focus();
  };

  // A customer's permissions hold for all its projects: every project page of the company, the
  // list and the customers are read again, and the dialog waits for this page's new answer.
  async function afterCustomerChange(): Promise<void> {
    void queryClient.invalidateQueries({ queryKey: projectsKey(company.companyId) });
    void queryClient.invalidateQueries({ queryKey: customersKey(company.companyId) });
    await queryClient.invalidateQueries({ queryKey: projectPagesKey(company.companyId) });
  }

  const founderOfProject = project.actions.setAiPermission;
  const founderOfCustomer = project.actions.setCustomerPermissions;

  let dialog: ReactNode = null;
  if (pending === 'project_on') {
    dialog = (
      <StepUpDialog<ProjectDetail | 'project_changed'>
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        request={{
          purpose: 'project_ai_permission',
          companyId: company.companyId,
          subjectId: project.id,
          details: projectAiPermissionDetails(confirmedId),
        }}
        action={(stepUp) =>
          setProjectAiPermission(company.companyId, project.id, {
            allowed: true,
            customerId: confirmedId,
            stepUp,
          }).catch((error: unknown) => {
            if (error instanceof ApiError && error.code === 'project_changed') {
              setChanged(error.message);
              return 'project_changed' as const;
            }
            throw error;
          })
        }
        onSuccess={(result) => {
          if (result === 'project_changed') {
            void queryClient.invalidateQueries({
              queryKey: projectKey(company.companyId, project.id),
            });
          } else {
            store(result);
          }
          close();
        }}
        onCloseAutoFocus={returnFocus}
        title={`${project.name} için yapay zekâ izni açılsın mı?`}
        description={
          'İzin açılınca ajanlar bu projede çalışabilir ve projenin kayıtları yapay zekâ modeline gönderilebilir. Projenin müşterisi varsa izni yalnızca müşterinin sözleşmesi yapay zekâ kullanımına izin veriyorsa açın. İzin açıkken projenin müşterisi değiştirilemez.' +
          (confirmed && !confirmed.aiAllowed
            ? ' Müşterinin sözleşme izni kapalı olduğu için ajanlar yine de çalışamaz.'
            : '')
        }
        confirmLabel="İzni aç"
      />
    );
  } else if (pending === 'project_off') {
    dialog = (
      <PlainConfirmation
        title={`${project.name} için yapay zekâ izni kapatılsın mı?`}
        description="Ajanlar bu projede artık çalışamaz. İzni yeniden açmak passkey ister."
        confirmLabel="İzni kapat"
        run={async () => {
          store(await setProjectAiPermission(company.companyId, project.id, { allowed: false }));
        }}
        onClose={close}
        onCloseAutoFocus={returnFocus}
      />
    );
  } else if (pending === 'customer_ai_on' && confirmed) {
    dialog = (
      <StepUpDialog<undefined>
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        request={{
          purpose: 'customer_ai_permission',
          companyId: company.companyId,
          subjectId: confirmed.id,
          details: customerPermissionDetails({}),
        }}
        action={async (stepUp) => {
          await setCustomerPermissions(company.companyId, confirmed.id, {
            aiAllowed: true,
            stepUp,
          });
          await afterCustomerChange();
          return undefined;
        }}
        onSuccess={close}
        onCloseAutoFocus={returnFocus}
        title={`${confirmed.name} için yapay zekâ izni açılsın mı?`}
        description="Sözleşmenin yapay zekâ kullanımına izin verdiğini işaretliyorsunuz. Bu izin müşterinin bütün projeleri için geçerlidir; ajanlar yalnızca yapay zekâ izni açık projelerde çalışır."
        confirmLabel="İzni aç"
      />
    );
  } else if (pending !== null && confirmed) {
    const text = {
      customer_ai_off: {
        title: `${confirmed.name} için yapay zekâ izni kapatılsın mı?`,
        description:
          'Bu müşterinin bütün projelerinde ajanlar artık çalışamaz. İzni yeniden açmak passkey ister.',
        confirmLabel: 'İzni kapat',
        permissions: { aiAllowed: false },
      },
      automated_on: {
        title: `${confirmed.name} için kodla otomatik işleme izni açılsın mı?`,
        description:
          'Sözleşmenin kodla yapılan otomatik işlemeye izin verdiğini işaretliyorsunuz. Hatırlatma gibi model kullanmayan otomatik işler bu müşteri için çalışabilir.',
        confirmLabel: 'İzni aç',
        permissions: { automatedProcessingAllowed: true },
      },
      automated_off: {
        title: `${confirmed.name} için kodla otomatik işleme izni kapatılsın mı?`,
        description: 'Hatırlatma gibi model kullanmayan otomatik işler de bu müşteri için durur.',
        confirmLabel: 'İzni kapat',
        permissions: { automatedProcessingAllowed: false },
      },
    }[pending as 'customer_ai_off' | 'automated_on' | 'automated_off'];
    dialog = (
      <PlainConfirmation
        title={text.title}
        description={text.description}
        confirmLabel={text.confirmLabel}
        run={async () => {
          await setCustomerPermissions(company.companyId, confirmed.id, text.permissions);
          await afterCustomerChange();
        }}
        onClose={close}
        onCloseAutoFocus={returnFocus}
      />
    );
  }

  // "İzin açık", never "Açık" alone: beside it stands a project that is itself open or closed.
  const permissionWord = PERMISSION_WORD[project.aiAllowed ? 'open' : 'closed'];
  return (
    <>
      <section aria-labelledby={aiHeading} className={SECTION}>
        <h3 id={aiHeading} className={SECTION_HEADING}>
          Yapay zekâ izni
        </h3>
        {founderOfProject ? (
          <div className={SWITCH_ROW}>
            <Switch
              aria-labelledby={aiHeading}
              aria-describedby={aiSentence}
              checked={project.aiAllowed}
              onClick={(event) => {
                ask(project.aiAllowed ? 'project_off' : 'project_on', event.currentTarget);
              }}
            />
            <span>{permissionWord}</span>
          </div>
        ) : (
          <p>{permissionWord}</p>
        )}
        <p id={aiSentence} className="text-ink-secondary">
          {agentsSentence(project)}
        </p>
        {founderOfProject ? null : (
          <p className="text-ink-secondary">İzni yalnızca kurucu değiştirir.</p>
        )}
        {changed ? (
          <p role="alert" className="text-destructive">
            {changed}
          </p>
        ) : null}
      </section>

      {customer ? (
        <section aria-labelledby={contractHeading} className={SECTION}>
          <h3 id={contractHeading} className={SECTION_HEADING}>
            Müşterinin sözleşmesi
          </h3>
          <dl className={FIELDS}>
            <dt className={FIELD_NAME}>Yapay zekâ kullanımı</dt>
            <dd className={SWITCH_ROW}>
              {founderOfCustomer ? (
                <Switch
                  aria-label="Sözleşme yapay zekâ kullanımına izin veriyor"
                  checked={customer.aiAllowed}
                  onClick={(event) => {
                    ask(
                      customer.aiAllowed ? 'customer_ai_off' : 'customer_ai_on',
                      event.currentTarget,
                    );
                  }}
                />
              ) : null}
              <span>{CONTRACT_WORD[customer.aiAllowed ? 'allowed' : 'forbidden']}</span>
            </dd>
            {/* The automated processing permission is the founder's to read. */}
            {customer.automatedProcessingAllowed === null ? null : (
              <>
                <dt className={FIELD_NAME}>Kodla otomatik işleme</dt>
                <dd className={SWITCH_ROW}>
                  {founderOfCustomer ? (
                    <Switch
                      aria-label="Sözleşme kodla otomatik işlemeye izin veriyor"
                      checked={customer.automatedProcessingAllowed}
                      onClick={(event) => {
                        ask(
                          customer.automatedProcessingAllowed ? 'automated_off' : 'automated_on',
                          event.currentTarget,
                        );
                      }}
                    />
                  ) : null}
                  <span>
                    {CONTRACT_WORD[customer.automatedProcessingAllowed ? 'allowed' : 'forbidden']}
                  </span>
                </dd>
              </>
            )}
          </dl>
          <p className="text-ink-secondary">
            {founderOfCustomer
              ? 'Bu izinler müşterinin bütün projeleri için geçerlidir.'
              : 'İzinleri yalnızca kurucu değiştirir.'}
          </p>
        </section>
      ) : null}
      {dialog}
    </>
  );
}

/**
 * The properties of a project, for the shell's properties panel: what the project is (status,
 * customer, target date, colour and icon, members, who opened it, who owns it now and when it
 * was opened), then its AI permission, then the contract permissions of its customer. Rule 12
 * reads both permissions; the sentence under the first says what they mean together for this
 * project.
 */
export function ProjectProperties({ project }: { project: ProjectDetail }) {
  const owner = project.members.find((member) => member.projectRole === 'owner');
  return (
    <div className="flex flex-col gap-5 text-sm">
      <dl className={FIELDS}>
        <dt className={FIELD_NAME}>Durum</dt>
        <dd>
          <StatusBadge kind="project" status={project.status} />
        </dd>
        <dt className={FIELD_NAME}>Müşteri</dt>
        <dd className="break-words">{project.customer?.name ?? 'Müşteri yok'}</dd>
        <dt className={FIELD_NAME}>Hedef tarih</dt>
        <dd>
          {project.targetDate ? (
            <time dateTime={project.targetDate}>{formatDay(project.targetDate)}</time>
          ) : (
            'Belirlenmedi'
          )}
        </dd>
        <dt className={FIELD_NAME}>Renk ve simge</dt>
        <dd className="flex items-center gap-2">
          <ProjectTile color={project.color} icon={project.icon} />
          {COLOR_NAME[project.color]}, {ICON_NAME[project.icon]}
        </dd>
        <dt className={FIELD_NAME}>Üyeler</dt>
        <dd className="tabular-nums">{project.members.length} kişi</dd>
        <dt className={FIELD_NAME}>Oluşturan</dt>
        <dd className="break-words">
          {project.createdBy ? personName(project.createdBy) : 'Bilinmiyor'}
        </dd>
        {/* Who owns the project now (8 October 2026, decision 44); who opened it never changes. */}
        <dt className={FIELD_NAME}>Sahip</dt>
        <dd className="break-words">{owner ? personName(owner) : 'Yok'}</dd>
        <dt className={FIELD_NAME}>Oluşturulma</dt>
        <dd>
          <time dateTime={project.createdAt}>{formatFull(project.createdAt)}</time>
        </dd>
      </dl>
      <Permissions project={project} />
    </div>
  );
}
