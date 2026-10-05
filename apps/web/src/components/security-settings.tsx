import type { Passkey, RegistrationOptionsResponse } from '@agent-office/shared';
import {
  browserSupportsWebAuthn,
  startRegistration,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TextField } from '@/components/form-field';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { NoticeView, StepUpDialog } from '@/components/step-up';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ApiError, userMessage } from '@/lib/api';
import {
  ceremonyValue,
  finishPasskeyRegistration,
  MAX_PASSKEYS,
  noticeFor,
  PASSKEYS_QUERY_KEY,
  passkeysQueryOptions,
  readPasskeyName,
  revokePasskey,
  settleCeremony,
  startPasskeyRegistration,
  type CeremonyResult,
  type Notice,
} from '@/lib/passkeys';
import { useCompany, useSession } from '@/lib/session';
import { useStepUp } from '@/lib/step-up';
import { formatDate, formatDateTime } from '@/lib/users';
import { busyProps } from '@/lib/utils';

// Settings, Güvenlik: the signed-in person's passkeys (3 October decision 7) and what to do when
// they are lost (5 October decision 3).

const listClass = '@container rounded-lg border border-line bg-surface';
const rowClass = 'border-b border-line px-4 py-3 last:border-b-0';
const rowGroupClass = 'flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between';

const PASSKEY_ADD = { purpose: 'passkey_add' } as const;

function PasskeyRow({
  passkey,
  last,
  sectionHeading,
}: {
  passkey: Passkey;
  /** The person's only passkey: removing it needs a fresh Google sign-in for a new one. */
  last: boolean;
  /** Takes the focus when this passkey is removed; the row and its button go away. */
  sectionHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const removed = useRef(false);
  const nameId = useId();
  return (
    <li className={rowClass}>
      <div role="group" aria-labelledby={nameId} className={rowGroupClass}>
        <div className="flex min-w-0 flex-col">
          <span id={nameId} className="truncate text-sm font-medium">
            {passkey.name}
          </span>
          <span className="text-sm text-ink-secondary">
            Eklendi: {formatDate(passkey.createdAt)}
          </span>
          <span className="text-sm text-ink-secondary">
            Son kullanım:{' '}
            {passkey.lastUsedAt ? formatDateTime(passkey.lastUsedAt) : 'henüz kullanılmadı'}
          </span>
        </div>
        <StepUpDialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button variant="outline" size="lg" className="self-start @lg:self-auto">
              Kaldır
            </Button>
          }
          request={{ purpose: 'passkey_revoke', subjectId: passkey.id }}
          action={(stepUp) => revokePasskey(passkey.id, stepUp)}
          onSuccess={() => {
            removed.current = true;
            setOpen(false);
            toast.success('Passkey kaldırıldı.');
            void queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
          }}
          onCloseAutoFocus={(event) => {
            if (!removed.current) return;
            removed.current = false;
            event.preventDefault();
            sectionHeading.current?.focus();
          }}
          title="Passkey kaldırılsın mı?"
          description={
            last
              ? `${passkey.name} son passkey'iniz. Kaldırırsanız önemli onayları ve üye değişikliklerini yapamazsınız; yeni passkey eklemek için çıkış yapıp yeniden Google ile girmeniz gerekir.`
              : `${passkey.name} ile artık doğrulama yapılamaz.`
          }
          confirmLabel="Kaldır"
          destructive
        />
      </div>
    </li>
  );
}

type Phase =
  | { step: 'name' }
  | {
      step: 'create';
      name: string;
      challengeId: string;
      options: RegistrationOptionsResponse['options'];
    };

interface Creation {
  ceremony: Promise<CeremonyResult<RegistrationResponseJSON>>;
  challengeId: string;
  name: string;
}

/**
 * Adding a passkey takes two presses, because each one may start only one ceremony (Safari):
 * 1. The name. The first passkey goes straight to the API; a further one is confirmed with a
 *    passkey already registered (passkey_add), whose options were fetched when the dialog opened.
 * 2. "Passkey oluştur": the browser creates the passkey with the options from step 1.
 */
function AddPasskeyContent({
  hasPasskeys,
  onAdded,
}: {
  hasPasskeys: boolean;
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ step: 'name' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const refreshList = () => {
    void queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
  };

  const toCreate = (result: RegistrationOptionsResponse, name: string) => {
    setNotice(null);
    setPhase({ step: 'create', name, challengeId: result.challengeId, options: result.options });
  };

  const stepUp = useStepUp<RegistrationOptionsResponse, string>({
    request: hasPasskeys && phase.step === 'name' ? PASSKEY_ADD : null,
    action: (proof, name) => startPasskeyRegistration(name, proof),
    onSuccess: toCreate,
  });
  const start = useMutation({
    mutationFn: (name: string) => startPasskeyRegistration(name),
    onSuccess: toCreate,
    onError: (error) => {
      setNotice(noticeFor(error, 'registration'));
      // A passkey may have been added or removed elsewhere meanwhile.
      refreshList();
    },
  });
  const finish = useMutation({
    mutationFn: async ({ ceremony, challengeId, name }: Creation) =>
      finishPasskeyRegistration({ challengeId, name, response: await ceremonyValue(ceremony) }),
    onSuccess: () => {
      toast.success('Passkey eklendi.');
      refreshList();
      onAdded();
    },
    onError: (error) => {
      setNotice(noticeFor(error, 'registration'));
      // The API used up or refused the registration; it starts again from the name. A prompt the
      // person cancelled leaves the registration open for another press.
      if (error instanceof ApiError) {
        setPhase({ step: 'name' });
        refreshList();
      }
    },
  });

  const busy = stepUp.busy || start.isPending || finish.isPending;
  // While a ceremony or a request is on its way the dialog stays open.
  const keepOpenWhileBusy = (event: Event) => {
    if (busy) event.preventDefault();
  };
  const contentProps = {
    onEscapeKeyDown: keepOpenWhileBusy,
    onPointerDownOutside: keepOpenWhileBusy,
    onInteractOutside: keepOpenWhileBusy,
  };

  function submitName() {
    if (busy) return;
    const read = readPasskeyName(form.getValues('name'));
    if (!read.ok) {
      form.setError('name', { type: 'validate', message: read.message }, { shouldFocus: true });
      return;
    }
    form.clearErrors('name');
    setNotice(null);
    if (hasPasskeys) {
      stepUp.confirm(read.name);
    } else {
      start.mutate(read.name);
    }
  }

  function create() {
    if (busy || phase.step !== 'create') return;
    setNotice(null);
    // Nothing is awaited before this call (Safari's user-gesture rule).
    const ceremony = settleCeremony(startRegistration({ optionsJSON: phase.options }));
    finish.mutate({ ceremony, challengeId: phase.challengeId, name: phase.name });
  }

  let shown = notice;
  if (shown === null && phase.step === 'name') {
    shown =
      stepUp.notice?.link === 'security'
        ? {
            tone: 'error',
            text: "Kayıtlı passkey'iniz bulunamadı. Bu pencereyi kapatıp yeniden açın.",
          }
        : stepUp.notice;
  }

  const cancel = (
    <DialogClose asChild>
      <Button
        variant="outline"
        size="lg"
        {...busyProps(busy)}
        onClick={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        Vazgeç
      </Button>
    </DialogClose>
  );

  if (phase.step === 'create') {
    return (
      <DialogContent {...contentProps}>
        <DialogTitle>Passkey ekle</DialogTitle>
        <DialogDescription>
          Şimdi bu cihazda {phase.name} adlı passkey'i oluşturun. Cihazınız parmak izi, yüz tanıma
          ya da ekran kilidiyle onay isteyecek.
        </DialogDescription>
        <NoticeView notice={shown} />
        <DialogFooter>
          {cancel}
          <Button size="lg" autoFocus {...busyProps(busy)} onClick={create}>
            Passkey oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent {...contentProps}>
      <DialogTitle>Passkey ekle</DialogTitle>
      <DialogDescription>
        {hasPasskeys
          ? "Passkey'e listede tanıyacağınız bir ad verin. Sonra kayıtlı passkey'lerinizden biriyle doğrulama yapılır."
          : "Passkey'e listede tanıyacağınız bir ad verin."}
      </DialogDescription>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submitName();
        }}
      >
        <TextField
          control={form.control}
          name="name"
          label="Ad"
          description="Örneğin MacBook ya da iPhone."
        />
        <NoticeView notice={shown} />
        <DialogFooter>
          {cancel}
          <Button type="submit" size="lg" {...busyProps(busy || (hasPasskeys && !stepUp.ready))}>
            {hasPasskeys ? 'Doğrula ve devam et' : 'Devam'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function AddPasskeyDialog({ hasPasskeys }: { hasPasskeys: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The list decides between the first passkey and a further one; it may be out of date.
        if (!next) void queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg">Passkey ekle</Button>
      </DialogTrigger>
      {open ? (
        <AddPasskeyContent
          hasPasskeys={hasPasskeys}
          onAdded={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

export function PasskeysSection() {
  const query = useQuery(passkeysQueryOptions);
  const session = useSession();
  // A founder's passkeys are not reset from the panel, in any company.
  const founder = session.memberships.some((membership) => membership.role === 'founder');
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const supported = browserSupportsWebAuthn();
  const passkeys = query.data;
  const canAdd = supported && passkeys !== undefined && passkeys.length < MAX_PASSKEYS;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="text-base font-semibold">
          Passkey'ler
        </h2>
        {canAdd ? <AddPasskeyDialog hasPasskeys={passkeys.length > 0} /> : null}
      </div>
      {supported ? null : (
        <p className="text-sm text-error">
          Bu tarayıcı passkey desteklemiyor. Passkey eklemek ve işlemleri onaylamak için güncel bir
          Safari, Chrome, Edge ya da Firefox kullanın.
        </p>
      )}
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
          title="Henüz passkey yok"
          description="Passkey ekle düğmesiyle bu cihazda ilk passkey'inizi ekleyin. İlk passkey, Google ile girişten sonraki 10 dakika içinde eklenebilir."
        />
      ) : (
        <>
          <ul className={listClass}>
            {query.data.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                last={query.data.length === 1}
                sectionHeading={heading}
              />
            ))}
          </ul>
          {query.data.length === 1 ? (
            <p className="text-sm text-ink-secondary">
              Yalnızca bir passkey'iniz var. Bu cihazı kaybederseniz önemli işlemleri
              onaylayamazsınız; ikinci bir cihazda da passkey ekleyin.
            </p>
          ) : null}
          <p className="text-sm text-ink-secondary">
            {founder
              ? "Passkey'lerinizin hepsini kaybederseniz sıfırlamayı veritabanı yöneticisi yapar. Sonra Google ile yeniden girip yeni passkey eklersiniz."
              : "Passkey'lerinizin hepsini kaybederseniz şirketinizin kurucusundan sıfırlamasını isteyin. Sonra Google ile yeniden girip yeni passkey eklersiniz."}
          </p>
          {query.data.length >= MAX_PASSKEYS ? (
            <p className="text-sm text-ink-secondary">
              En fazla {MAX_PASSKEYS} passkey kaydedilebilir. Yenisini eklemek için önce
              kullanmadığınız birini kaldırın.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * On the Bugün screen, for a person who confirms important work (the founder, or an employee with
 * the approval right) and has no passkey yet: the first passkey can be added only within 10 minutes
 * of a Google sign-in, which is now. Shows nothing while the list loads or when it cannot be read.
 */
export function PasskeyReminder() {
  const company = useCompany();
  const needsPasskey = company.role === 'founder' || company.canApprove;
  const query = useQuery({ ...passkeysQueryOptions, enabled: needsPasskey });
  const headingId = useId();
  if (!needsPasskey || !query.isSuccess || query.data.length > 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-base font-semibold">
        Passkey ekleyin
      </h2>
      <p className="text-sm text-ink-secondary">
        Önemli onaylar ve üye değişiklikleri passkey ile doğrulanır. İlk passkey, Google ile
        girişten sonraki 10 dakika içinde eklenebilir; şimdi ekleyin.
      </p>
      <Button asChild size="lg">
        <Link to="/c/$company/settings/security" params={{ company: company.code }}>
          Güvenlik sayfasını aç
        </Link>
      </Button>
    </section>
  );
}
