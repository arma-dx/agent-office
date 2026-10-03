import type { StepUp, StepUpOptionsRequest } from '@agent-office/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { STEP_UP_TEXT, type Notice } from '@/lib/passkeys';
import { GOOGLE_SIGN_IN_HREF, googleSignInHref, useOptionalCompany } from '@/lib/session';
import { useStepUp } from '@/lib/step-up';
import { busyProps } from '@/lib/utils';

const linkClass = 'font-medium text-brand underline underline-offset-4';

/**
 * The message of a passkey dialog. The status region is always in the page, so screen readers
 * announce a quiet message (preparing, cancelled) when it enters; errors are alerts. The parent
 * lays its children out with gap-4, which the empty status region takes back.
 */
export function NoticeView({ notice }: { notice: Notice | null }) {
  const company = useOptionalCompany();
  return (
    <>
      <p role="status" className="text-sm text-ink-secondary empty:-mt-4">
        {notice?.tone === 'quiet' ? notice.text : null}
      </p>
      {notice?.tone === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p className="text-error">{notice.text}</p>
          {notice.link === 'security' && company ? (
            <Link
              to="/c/$company/settings/security"
              params={{ company: company.code }}
              className={linkClass}
            >
              Güvenlik sayfasını aç
            </Link>
          ) : null}
          {notice.link === 'sign_in' ? (
            // Back to the Güvenlik page after the sign-in, where the 10 minutes for the first
            // passkey start.
            <a
              href={
                company
                  ? googleSignInHref(`/c/${company.code}/settings/security`)
                  : GOOGLE_SIGN_IN_HREF
              }
              className={linkClass}
            >
              Yeniden giriş yap
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface StepUpDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the re-verification confirms; the same change the action sends. */
  request: StepUpOptionsRequest | null;
  /** The protected request, sent with the signed answer. */
  action: (stepUp: StepUp) => Promise<T>;
  /** Runs when the API accepted the action; close the dialog here. */
  onSuccess: (result: T) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** The button that opens the dialog; without it the caller opens it and returns the focus. */
  trigger?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Confirmation dialog for an action that needs a passkey (approvals that matter, membership
 * changes, removing a passkey). The options are fetched when it opens; the confirm button starts
 * the ceremony in its click handler and sends the action with `stepUp`. The dialog stays open until
 * the API accepts, and cannot be closed while the request is on its way.
 */
export function StepUpDialog<T>({
  open,
  onOpenChange,
  request,
  trigger,
  ...props
}: StepUpDialogProps<T>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      {open && request !== null ? <StepUpDialogContent request={request} {...props} /> : null}
    </AlertDialog>
  );
}

function StepUpDialogContent<T>({
  request,
  action,
  onSuccess,
  title,
  description,
  confirmLabel,
  destructive = false,
  onCloseAutoFocus,
}: Omit<StepUpDialogProps<T>, 'open' | 'onOpenChange' | 'trigger' | 'request'> & {
  request: StepUpOptionsRequest;
}) {
  const stepUp = useStepUp({ request, action, onSuccess });
  return (
    <AlertDialogContent
      onEscapeKeyDown={(event) => {
        if (stepUp.busy) event.preventDefault();
      }}
      {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
    >
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription>{description}</AlertDialogDescription>
      <p className="text-sm">{STEP_UP_TEXT.hint}</p>
      <NoticeView notice={stepUp.notice} />
      <AlertDialogFooter>
        <AlertDialogCancel
          {...busyProps(stepUp.busy)}
          onClick={(event) => {
            if (stepUp.busy) event.preventDefault();
          }}
        >
          Vazgeç
        </AlertDialogCancel>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          size="lg"
          {...busyProps(stepUp.busy || !stepUp.ready)}
          onClick={() => {
            stepUp.confirm();
          }}
        >
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
