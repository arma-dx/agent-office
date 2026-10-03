import {
  createInvitationRequestSchema,
  type Invitation,
  type Member,
  type Role,
} from '@agent-office/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type RefObject } from 'react';
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { TextField } from '@/components/form-field';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { ApiError, userMessage } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import {
  cancelInvitation,
  createInvitation,
  formatDate,
  formatDateTime,
  INVITATION_STATUS_LABELS,
  invitationActions,
  invitationsQueryOptions,
  membersQueryOptions,
  removeMember,
  renewInvitation,
  ROLE_LABELS,
  updateMember,
} from '@/lib/users';
import { cn } from '@/lib/utils';

type InvitableRole = Exclude<Role, 'founder'>;

const sectionHeadingClass = 'text-base font-semibold';

/**
 * A control that is busy with a request stays focusable: `disabled` would drop the keyboard focus
 * to the page (and a screen reader's place with it), so the control is marked aria-disabled and its
 * handler ignores input while busy.
 */
function busyProps(busy: boolean): { 'aria-disabled'?: true } {
  return busy ? { 'aria-disabled': true } : {};
}

function focusHeading(heading: RefObject<HTMLHeadingElement | null>) {
  heading.current?.focus();
}
// Rows put their controls beside the name only when the list itself is wide enough (container query).
const listClass = '@container rounded-lg border border-line bg-surface';
const rowClass = 'border-b border-line px-4 py-3 last:border-b-0';
// Each row is a group named after the person or address; a screen reader names the row before
// its controls ("Rol", "Onay yetkisi"), which keep short labels.
const rowGroupClass = 'flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between';

// Members

function memberSummary(member: Member): string {
  return [
    ROLE_LABELS[member.role],
    member.canApprove ? 'onay yetkisi var' : 'onay yetkisi yok',
    member.active ? 'etkin' : 'devre dışı',
  ].join(', ');
}

function MemberRow({
  companyId,
  member,
  sectionHeading,
}: {
  companyId: string;
  member: Member;
  /** Takes the focus when this row's removal is confirmed; the row and its button go away. */
  sectionHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const removalConfirmed = useRef(false);
  const nameId = useId();
  const roleId = useId();
  const approveId = useId();
  const membersKey = membersQueryOptions(companyId).queryKey;

  const update = useMutation({
    mutationFn: (changes: { role?: InvitableRole; canApprove?: boolean }) =>
      updateMember(companyId, member.userId, changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(membersKey, (previous) =>
        previous?.map((m) => (m.userId === updated.userId ? updated : m)),
      );
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: () => removeMember(companyId, member.userId),
    onSuccess: () => {
      toast.success(`${member.name} üyelikten çıkarıldı.`);
      void queryClient.invalidateQueries({ queryKey: membersKey });
    },
    onError: notifyError,
  });

  const busy = update.isPending || remove.isPending;
  // While a change is on its way, the controls show the chosen value instead of jumping back.
  const role = (update.isPending ? update.variables.role : undefined) ?? member.role;
  const canApprove =
    (update.isPending ? update.variables.canApprove : undefined) ?? member.canApprove;
  // The founder role is not given or taken through the panel.
  const editable = member.role !== 'founder';

  return (
    <li className={rowClass}>
      <div role="group" aria-labelledby={nameId} className={rowGroupClass}>
        <div className="flex min-w-0 flex-col">
          <span id={nameId} className="truncate text-sm font-medium">
            {member.name}
          </span>
          <span className="text-sm text-ink-secondary">{memberSummary(member)}</span>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor={roleId} className="text-sm">
                Rol
              </label>
              <NativeSelect
                id={roleId}
                value={role}
                {...busyProps(busy)}
                onChange={(event) => {
                  if (busy) return;
                  const next = z.enum(['employee', 'external']).parse(event.target.value);
                  // Approval rights belong to employees only; they go with the change to external.
                  update.mutate(
                    next === 'external' ? { role: next, canApprove: false } : { role: next },
                  );
                }}
              >
                <option value="employee">{ROLE_LABELS.employee}</option>
                <option value="external">{ROLE_LABELS.external}</option>
              </NativeSelect>
            </div>
            {role === 'employee' ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={approveId}
                  checked={canApprove}
                  {...busyProps(busy)}
                  onCheckedChange={(checked) => {
                    if (busy) return;
                    update.mutate({ canApprove: checked });
                  }}
                />
                <label htmlFor={approveId} className="text-sm">
                  Onay yetkisi
                </label>
              </div>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="lg"
                  {...busyProps(busy)}
                  onClick={(event) => {
                    // Radix skips opening the dialog when the click is prevented.
                    if (busy) event.preventDefault();
                  }}
                >
                  Üyelikten çıkar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  if (!removalConfirmed.current) return;
                  // The row and its button are about to go; the section heading keeps the place.
                  removalConfirmed.current = false;
                  event.preventDefault();
                  focusHeading(sectionHeading);
                }}
              >
                <AlertDialogTitle>{member.name} üyelikten çıkarılsın mı?</AlertDialogTitle>
                <AlertDialogDescription>
                  Bu şirketin paneline ve kayıtlarına artık erişemez. Gerekirse yeniden davet
                  edebilirsiniz.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      removalConfirmed.current = true;
                      remove.mutate();
                    }}
                  >
                    Üyelikten çıkar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function MembersSection({ companyId }: { companyId: string }) {
  const query = useQuery(membersQueryOptions(companyId));
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} ref={heading} tabIndex={-1} className={sectionHeadingClass}>
        Üyeler
      </h2>
      {query.isPending ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorMessage
          message={userMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <ul className={listClass}>
          {query.data.map((member) => (
            <MemberRow
              key={member.userId}
              companyId={companyId}
              member={member}
              sectionHeading={heading}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// Invitations

const invitationStatusClass: Record<Invitation['status'], string> = {
  pending: 'text-awaiting-approval',
  expired: 'text-ink-secondary',
  accepted: 'text-brand',
  cancelled: 'text-ink-secondary',
};

function InvitationRow({
  companyId,
  invitation,
  sectionHeading,
}: {
  companyId: string;
  invitation: Invitation;
  /** Takes the focus when the row's buttons go away (cancelled, or no more extension). */
  sectionHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const emailId = useId();
  const invitationsKey = invitationsQueryOptions(companyId).queryKey;
  const replace = (updated: Invitation) => {
    queryClient.setQueryData(invitationsKey, (previous) =>
      previous?.map((i) => (i.id === updated.id ? updated : i)),
    );
  };

  const extend = useMutation({
    mutationFn: () => renewInvitation(companyId, invitation.id),
    onSuccess: (updated) => {
      replace(updated);
      toast.success(
        `Davetin süresi uzatıldı. Geçerlilik sonu: ${formatDateTime(updated.expiresAt)}.`,
      );
      // At the 30-day limit the button goes away with the extension.
      if (!invitationActions(updated).canExtend) focusHeading(sectionHeading);
    },
    onError: notifyError,
  });
  const cancel = useMutation({
    mutationFn: () => cancelInvitation(companyId, invitation.id),
    onSuccess: () => {
      replace({ ...invitation, status: 'cancelled' });
      toast.success('Davet iptal edildi.');
      focusHeading(sectionHeading);
      void queryClient.invalidateQueries({ queryKey: invitationsKey });
    },
    onError: notifyError,
  });

  const busy = extend.isPending || cancel.isPending;
  const { canExtend, canCancel } = invitationActions(invitation);
  const open = invitation.status === 'pending' || invitation.status === 'expired';
  const details = [ROLE_LABELS[invitation.role], invitation.canApprove ? 'onay yetkisi var' : null]
    .filter(Boolean)
    .join(', ');
  const dateLine = open
    ? `Geçerlilik sonu: ${formatDateTime(invitation.expiresAt)}`
    : `Oluşturuldu: ${formatDate(invitation.createdAt)}`;

  return (
    <li className={rowClass}>
      <div role="group" aria-labelledby={emailId} className={rowGroupClass}>
        <div className="flex min-w-0 flex-col">
          <span id={emailId} className="truncate text-sm font-medium">
            {invitation.email}
          </span>
          <span className="text-sm text-ink-secondary">{details}</span>
          <span className="text-sm text-ink-secondary">{dateLine}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={cn('text-sm font-medium', invitationStatusClass[invitation.status])}>
            {INVITATION_STATUS_LABELS[invitation.status]}
          </span>
          {canExtend ? (
            <Button
              variant="outline"
              size="lg"
              {...busyProps(busy)}
              onClick={() => {
                if (!busy) extend.mutate();
              }}
            >
              Süreyi uzat
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              variant="outline"
              size="lg"
              {...busyProps(busy)}
              onClick={() => {
                if (!busy) cancel.mutate();
              }}
            >
              İptal et
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function InvitationsSection({ companyId }: { companyId: string }) {
  const query = useQuery(invitationsQueryOptions(companyId));
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} ref={heading} tabIndex={-1} className={sectionHeadingClass}>
        Davetler
      </h2>
      {query.isPending ? (
        <LoadingRows rows={2} />
      ) : query.isError ? (
        <ErrorMessage
          message={userMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="Henüz davet yok"
          description="Yeni davet formuna kişinin Google adresini yazıp ilk daveti oluşturun."
        />
      ) : (
        <ul className={listClass}>
          {query.data.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              companyId={companyId}
              invitation={invitation}
              sectionHeading={heading}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// New invitation

type InviteInput = z.input<typeof createInvitationRequestSchema>;
type InviteOutput = z.output<typeof createInvitationRequestSchema>;

/** Turkish messages for the shared schema, whose own messages are for developers. */
const inviteErrors: z.core.$ZodErrorMap = (issue) => {
  const field = issue.path?.[0];
  if (field === 'email') {
    if (issue.code === 'too_big') return 'E-posta adresi en çok 254 karakter olabilir.';
    if (typeof issue.input !== 'string' || issue.input === '') return 'E-posta adresini yazın.';
    return 'Geçerli bir e-posta adresi yazın, örneğin ad@sirket.com.';
  }
  if (field === 'role') return 'Rol seçin: Çalışan ya da Dış kişi.';
  return 'Bu alanı kontrol edin.';
};

const schemaResolver = zodResolver(createInvitationRequestSchema, { error: inviteErrors });

// Spaces around a pasted address are dropped before the check; the schema lowercases it.
const inviteResolver: Resolver<InviteInput, unknown, InviteOutput> = (values, context, options) =>
  schemaResolver({ ...values, email: values.email.trim() }, context, options);

function inviteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === undefined && error.status === 409) {
    return 'Bu adrese kabul edilmemiş bir davet zaten var; süresi dolmuş olabilir. Davetler listesinden süresini uzatın ya da daveti iptal edip yeniden oluşturun.';
  }
  return userMessage(error);
}

export function InviteForm({ companyId, className }: { companyId: string; className?: string }) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const roleId = useId();
  const roleDescriptionId = useId();
  const approveId = useId();
  const approveDescriptionId = useId();
  const [created, setCreated] = useState<Invitation | null>(null);

  const form = useForm<InviteInput, unknown, InviteOutput>({
    resolver: inviteResolver,
    defaultValues: { email: '', role: 'employee', canApprove: false },
  });
  const role = useWatch({ control: form.control, name: 'role' });

  const create = useMutation({
    mutationFn: (values: InviteOutput) => createInvitation(companyId, values),
    onSuccess: (invitation) => {
      setCreated(invitation);
      form.reset();
      void queryClient.invalidateQueries({
        queryKey: invitationsQueryOptions(companyId).queryKey,
      });
    },
  });

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-4 rounded-lg border border-line bg-surface p-4', className)}
    >
      <h2 id={headingId} className={sectionHeadingClass}>
        Yeni davet
      </h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          if (create.isPending) {
            event.preventDefault();
            return;
          }
          void form.handleSubmit((values) => {
            setCreated(null);
            create.mutate(values);
          })(event);
        }}
      >
        <TextField
          control={form.control}
          name="email"
          type="email"
          label="E-posta"
          description="Kişinin Google ile gireceği adres."
        />
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={roleId}>Rol</FieldLabel>
              <NativeSelect
                id={roleId}
                aria-describedby={roleDescriptionId}
                name={field.name}
                ref={field.ref}
                value={field.value}
                onBlur={field.onBlur}
                onChange={(event) => {
                  field.onChange(event.target.value);
                  if (event.target.value === 'external') form.setValue('canApprove', false);
                }}
              >
                <option value="employee">{ROLE_LABELS.employee}</option>
                <option value="external">{ROLE_LABELS.external}</option>
              </NativeSelect>
              <FieldDescription id={roleDescriptionId}>
                {field.value === 'external'
                  ? 'Dış kişi yalnızca kendisine açılan görev ve notları görür.'
                  : 'Çalışan şirketin görev ve notlarıyla çalışır.'}
              </FieldDescription>
            </Field>
          )}
        />
        {role === 'employee' ? (
          <Controller
            control={form.control}
            name="canApprove"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Switch
                  id={approveId}
                  aria-describedby={approveDescriptionId}
                  name={field.name}
                  ref={field.ref}
                  checked={field.value ?? false}
                  onBlur={field.onBlur}
                  onCheckedChange={field.onChange}
                />
                <FieldContent>
                  <FieldLabel htmlFor={approveId}>Onay yetkisi</FieldLabel>
                  <FieldDescription id={approveDescriptionId}>
                    Onay Masası'nda onay verebilir.
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
          />
        ) : null}
        <div>
          <Button type="submit" size="lg" {...busyProps(create.isPending)}>
            Davet oluştur
          </Button>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-error">
            {inviteErrorMessage(create.error)}
          </p>
        ) : null}
      </form>
      {/* The live region is always in the page, so that screen readers announce what enters it. */}
      <div role="status" aria-label="Davet sonucu" className="empty:-mt-4">
        {created ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
            <p>
              Davet oluşturuldu ama e-postayla gönderilmez. Kişiye panel adresini iletin ve bu
              e-posta adresiyle Google ile girmesini söyleyin.
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-ink-secondary">E-posta</dt>
              <dd className="break-all">{created.email}</dd>
              <dt className="text-ink-secondary">Panel adresi</dt>
              <dd className="break-all">{window.location.origin}</dd>
              <dt className="text-ink-secondary">Geçerlilik sonu</dt>
              <dd>{formatDateTime(created.expiresAt)}</dd>
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}
