import {
  invitationChangeDetails,
  invitationFieldsSchema,
  memberChangeDetails,
  type Invitation,
  type InvitationFields,
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
import { StepUpDialog } from '@/components/step-up';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { ApiError, userMessage } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { useSession } from '@/lib/session';
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
  resetMemberPasskeys,
  ROLE_LABELS,
  updateMember,
} from '@/lib/users';
import { busyProps, cn } from '@/lib/utils';

type InvitableRole = Exclude<Role, 'founder'>;

const sectionHeadingClass = 'text-base font-semibold';

function focusHeading(heading: RefObject<HTMLHeadingElement | null>) {
  heading.current?.focus();
}
// Rows put their controls beside the name only when the list itself is wide enough (container query).
const listClass = '@container rounded-lg border border-line bg-surface';
const rowClass = 'border-b border-line px-4 py-3 last:border-b-0';
// Each row is a group named after the person or address; a screen reader names the row before
// its controls ("Rol", "Onay yetkisi"), which keep short labels.
const rowGroupClass = 'flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between';
// A member row has up to four controls (role, approval right, passkey reset, removal): they go
// beside the name only in a list wide enough to keep them on one line.
const memberRowGroupClass =
  'flex flex-col gap-3 @4xl:flex-row @4xl:items-center @4xl:justify-between';

// Members

function memberSummary(member: Member): string {
  return [
    ROLE_LABELS[member.role],
    member.canApprove ? 'onay yetkisi var' : 'onay yetkisi yok',
    member.active ? 'etkin' : 'devre dışı',
  ].join(', ');
}

/** A membership change waiting for its confirmation: exactly what PATCH or DELETE sends. */
type MemberChange = { role?: InvitableRole; canApprove?: boolean } | 'remove';

function changeText(
  member: Member,
  change: MemberChange,
): { title: string; description: string; confirmLabel: string; destructive?: boolean } {
  if (change === 'remove') {
    return {
      title: `${member.name} üyelikten çıkarılsın mı?`,
      description:
        'Bu şirketin paneline ve kayıtlarına artık erişemez. Gerekirse yeniden davet edebilirsiniz.',
      confirmLabel: 'Üyelikten çıkar',
      destructive: true,
    };
  }
  if (change.role === 'external') {
    return {
      title: `${member.name} dış kişi olsun mu?`,
      description: member.canApprove
        ? 'Dış kişi yalnızca kendisine açılan görev ve notları görür. Onay yetkisi de kalkar.'
        : 'Dış kişi yalnızca kendisine açılan görev ve notları görür.',
      confirmLabel: 'Rolü değiştir',
    };
  }
  if (change.role === 'employee') {
    return {
      title: `${member.name} çalışan olsun mu?`,
      description: 'Çalışan şirketin görev ve notlarıyla çalışır.',
      confirmLabel: 'Rolü değiştir',
    };
  }
  return change.canApprove
    ? {
        title: `${member.name} için onay yetkisi açılsın mı?`,
        description: "Onay Masası'nda onay verebilir.",
        confirmLabel: 'Yetkiyi aç',
      }
    : {
        title: `${member.name} için onay yetkisi kapatılsın mı?`,
        description: "Onay Masası'nda artık onay veremez.",
        confirmLabel: 'Yetkiyi kapat',
      };
}

/**
 * Confirms a membership change with a passkey (3 October decision 7). The re-verification names
 * this company, this member and this exact change; the API refuses any other.
 */
function MemberChangeDialog({
  companyId,
  member,
  change,
  onClose,
  returnFocus,
  sectionHeading,
}: {
  companyId: string;
  member: Member;
  change: MemberChange;
  onClose: () => void;
  /** The control that asked for the change; it takes the focus back. */
  returnFocus: RefObject<HTMLElement | null>;
  /** Takes the focus when the member is removed; the row and its controls go away. */
  sectionHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const removed = useRef(false);
  const membersKey = membersQueryOptions(companyId).queryKey;
  return (
    <StepUpDialog<Member | undefined>
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      request={{
        purpose: 'membership_change',
        companyId,
        subjectId: member.userId,
        details: memberChangeDetails(change),
      }}
      action={(stepUp) =>
        change === 'remove'
          ? removeMember(companyId, member.userId, stepUp)
          : updateMember(companyId, member.userId, { ...change, stepUp })
      }
      onSuccess={(updated) => {
        if (updated === undefined) {
          removed.current = true;
          toast.success(`${member.name} üyelikten çıkarıldı.`);
          void queryClient.invalidateQueries({ queryKey: membersKey });
        } else {
          queryClient.setQueryData(membersKey, (previous) =>
            previous?.map((m) => (m.userId === updated.userId ? updated : m)),
          );
        }
        onClose();
      }}
      onCloseAutoFocus={(event) => {
        // The dialog has no trigger of its own: the focus goes back to the control by hand.
        event.preventDefault();
        if (removed.current) {
          focusHeading(sectionHeading);
        } else {
          returnFocus.current?.focus();
        }
      }}
      {...changeText(member, change)}
    />
  );
}

/**
 * Resets every passkey of a member who lost theirs (5 October decision 3), confirmed with the
 * founder's own passkey. The re-verification names this company and this person. The person is
 * signed out everywhere and adds a first passkey again after a new Google sign-in: whoever signs in
 * to the account first adds it, so the dialog asks for the Google session on a lost device to be
 * closed before the reset.
 */
function PasskeyResetButton({
  companyId,
  member,
  onReset,
}: {
  companyId: string;
  member: Member;
  /** Runs when the API reset the passkeys; the section then says what the founder does next. */
  onReset: (member: Member) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <StepUpDialog<undefined>
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="lg">
          Passkey'leri sıfırla
        </Button>
      }
      request={{ purpose: 'passkey_reset', companyId, subjectId: member.userId }}
      action={(stepUp) => resetMemberPasskeys(companyId, member.userId, stepUp)}
      onSuccess={() => {
        onReset(member);
        setOpen(false);
      }}
      title={`${member.name} için passkey'ler sıfırlansın mı?`}
      description="Bu kişinin bütün passkey'leri kaldırılır ve açık oturumları kapatılır. Kişi Google ile yeniden girip 10 dakika içinde yeni bir passkey ekler. Cihazı kaybolduysa önce o cihazdaki Google oturumunu kapatmasını ya da Google parolasını değiştirmesini isteyin; yoksa cihazı bulan kişi yeni passkey'i ekleyebilir."
      confirmLabel="Passkey'leri sıfırla"
      destructive
    />
  );
}

function MemberRow({
  companyId,
  member,
  sectionHeading,
  onPasskeysReset,
}: {
  companyId: string;
  member: Member;
  sectionHeading: RefObject<HTMLHeadingElement | null>;
  onPasskeysReset: (member: Member) => void;
}) {
  const session = useSession();
  const [pending, setPending] = useState<MemberChange | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const roleId = useId();
  const approveId = useId();
  // The founder role is not given or taken through the panel.
  const editable = member.role !== 'founder';
  // A founder's passkeys are not reset from the panel, and nobody resets their own.
  const resettable = editable && member.userId !== session.user.id;

  // Every change waits in a confirmation dialog; the controls keep showing the saved value.
  function ask(change: MemberChange, control: HTMLElement | null) {
    returnFocus.current = control;
    setPending(change);
  }

  return (
    <li className={rowClass}>
      <div role="group" aria-labelledby={nameId} className={memberRowGroupClass}>
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
                value={member.role}
                onChange={(event) => {
                  const next = z.enum(['employee', 'external']).parse(event.target.value);
                  if (next === member.role) return;
                  // Approval rights belong to employees only; they go with the change to external.
                  ask(
                    next === 'external' ? { role: next, canApprove: false } : { role: next },
                    event.currentTarget,
                  );
                }}
              >
                <option value="employee">{ROLE_LABELS.employee}</option>
                <option value="external">{ROLE_LABELS.external}</option>
              </NativeSelect>
            </div>
            {member.role === 'employee' ? (
              <div className="flex items-center gap-2">
                <Switch
                  ref={switchRef}
                  id={approveId}
                  checked={member.canApprove}
                  onCheckedChange={(checked) => {
                    ask({ canApprove: checked }, switchRef.current);
                  }}
                />
                <label htmlFor={approveId} className="text-sm">
                  Onay yetkisi
                </label>
              </div>
            ) : null}
            {resettable ? (
              <PasskeyResetButton companyId={companyId} member={member} onReset={onPasskeysReset} />
            ) : null}
            <Button
              variant="outline"
              size="lg"
              onClick={(event) => {
                ask('remove', event.currentTarget);
              }}
            >
              Üyelikten çıkar
            </Button>
          </div>
        ) : null}
      </div>
      {pending !== null ? (
        <MemberChangeDialog
          companyId={companyId}
          member={member}
          change={pending}
          onClose={() => {
            setPending(null);
          }}
          returnFocus={returnFocus}
          sectionHeading={sectionHeading}
        />
      ) : null}
    </li>
  );
}

export function MembersSection({ companyId }: { companyId: string }) {
  const query = useQuery(membersQueryOptions(companyId));
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The member whose passkeys were reset last; the note below stays until the page is left.
  const [passkeysReset, setPasskeysReset] = useState<Member | null>(null);
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
              onPasskeysReset={setPasskeysReset}
            />
          ))}
        </ul>
      )}
      {/*
        The panel sends the person no e-mail and their sessions are closed, so the founder tells
        them (5 October decision 3: the person is told). The live region is always in the page, so
        that screen readers announce what enters it.
      */}
      <div role="status" aria-label="Passkey sıfırlama sonucu" className="empty:-mt-3">
        {passkeysReset ? (
          <p className="rounded-lg border border-line bg-surface p-3 text-sm">
            {passkeysReset.name} için passkey'ler sıfırlandı. Kişiye e-posta gitmez; kendisine haber
            verin: Google ile yeniden girip 10 dakika içinde Güvenlik sayfasından yeni passkey
            eklesin.
          </p>
        ) : null}
      </div>
    </section>
  );
}

// Invitations

// Invitation statuses are not part of the status language of tasks, approvals and runs
// (lib/status.ts). The pending color is an open question for the founder (docs/SONRA.md).
const invitationStatusClass: Record<Invitation['status'], string> = {
  pending: 'text-status-open-text',
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
  const [extending, setExtending] = useState(false);
  // The extension reached the 30-day limit: the button goes away with it.
  const extendGone = useRef(false);
  const invitationsKey = invitationsQueryOptions(companyId).queryKey;
  const replace = (updated: Invitation) => {
    queryClient.setQueryData(invitationsKey, (previous) =>
      previous?.map((i) => (i.id === updated.id ? updated : i)),
    );
  };

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

  const busy = cancel.isPending;
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
            // An invitation becomes a membership at the first sign-in, so renewing an expired
            // grant is confirmed with a passkey (3 October decision 7).
            <StepUpDialog<Invitation>
              open={extending}
              onOpenChange={setExtending}
              trigger={
                <Button
                  variant="outline"
                  size="lg"
                  {...busyProps(busy)}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                >
                  Süreyi uzat
                </Button>
              }
              request={{
                purpose: 'invitation',
                companyId,
                subjectId: invitation.id,
                details: invitationChangeDetails('renew'),
              }}
              action={(stepUp) => renewInvitation(companyId, invitation.id, stepUp)}
              onSuccess={(updated) => {
                replace(updated);
                toast.success(
                  `Davetin süresi uzatıldı. Geçerlilik sonu: ${formatDateTime(updated.expiresAt)}.`,
                );
                extendGone.current = !invitationActions(updated).canExtend;
                setExtending(false);
              }}
              onCloseAutoFocus={(event) => {
                if (!extendGone.current) return;
                extendGone.current = false;
                event.preventDefault();
                focusHeading(sectionHeading);
              }}
              title="Davetin süresi uzatılsın mı?"
              description={`${invitation.email} için davet 7 gün daha geçerli olur; oluşturulduktan sonra en çok 30 gün.`}
              confirmLabel="Süreyi uzat"
            />
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

type InviteInput = z.input<typeof invitationFieldsSchema>;
type InviteOutput = z.output<typeof invitationFieldsSchema>;

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

const schemaResolver = zodResolver(invitationFieldsSchema, { error: inviteErrors });

// Spaces around a pasted address are dropped before the check; the schema lowercases it.
const inviteResolver: Resolver<InviteInput, unknown, InviteOutput> = (values, context, options) =>
  schemaResolver({ ...values, email: values.email.trim() }, context, options);

const INVITATION_EXISTS_TEXT =
  'Bu adrese kabul edilmemiş bir davet zaten var; süresi dolmuş olabilir. Davetler listesinden süresini uzatın ya da daveti iptal edip yeniden oluşturun.';

/** A 409 without the agreed body (a proxy, say) gets the same words as the API's own answer. */
function inviteError(error: unknown): unknown {
  if (error instanceof ApiError && error.code === undefined && error.status === 409) {
    return new ApiError(409, INVITATION_EXISTS_TEXT, 'invitation_exists');
  }
  return error;
}

function inviteText(values: InvitationFields): string {
  const role = values.role === 'employee' ? 'çalışan' : 'dış kişi';
  const right = values.canApprove ? ', onay yetkisiyle' : '';
  return `${values.email} adresi ${role} olarak${right} davet edilir. Kişi bu adresle Google ile ilk girdiğinde üye olur.`;
}

/** A new invitation waiting for its confirmation; the panel gives it its id. */
interface PendingInvitation {
  id: string;
  values: InviteOutput;
}

export function InviteForm({ companyId, className }: { companyId: string; className?: string }) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const roleId = useId();
  const roleDescriptionId = useId();
  const approveId = useId();
  const approveDescriptionId = useId();
  const submitRef = useRef<HTMLButtonElement>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [pending, setPending] = useState<PendingInvitation | null>(null);

  const form = useForm<InviteInput, unknown, InviteOutput>({
    resolver: inviteResolver,
    defaultValues: { email: '', role: 'employee', canApprove: false },
  });
  const role = useWatch({ control: form.control, name: 'role' });

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
          if (pending !== null) {
            event.preventDefault();
            return;
          }
          void form.handleSubmit((values) => {
            setCreated(null);
            // The re-verification names the new invitation, so it gets its id here.
            setPending({ id: crypto.randomUUID(), values });
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
          <Button ref={submitRef} type="submit" size="lg" {...busyProps(pending !== null)}>
            Davet oluştur
          </Button>
        </div>
      </form>
      {pending !== null ? (
        // An invitation becomes a membership, with its role and approval right, at the first
        // sign-in: it is confirmed with a passkey (3 October decision 7).
        <StepUpDialog<Invitation>
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          request={{
            purpose: 'invitation',
            companyId,
            subjectId: pending.id,
            details: invitationChangeDetails(pending.values),
          }}
          action={(stepUp) =>
            createInvitation(companyId, { ...pending.values, id: pending.id, stepUp }).catch(
              (error: unknown) => {
                throw inviteError(error);
              },
            )
          }
          onSuccess={(invitation) => {
            setCreated(invitation);
            form.reset();
            void queryClient.invalidateQueries({
              queryKey: invitationsQueryOptions(companyId).queryKey,
            });
            setPending(null);
          }}
          onCloseAutoFocus={(event) => {
            // The dialog has no trigger of its own: the focus goes back to the form's button.
            event.preventDefault();
            submitRef.current?.focus();
          }}
          title="Davet oluşturulsun mu?"
          description={inviteText(pending.values)}
          confirmLabel="Davet oluştur"
        />
      ) : null}
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
