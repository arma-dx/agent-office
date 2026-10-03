import { GOOGLE_SIGN_IN_HREF } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Google's standard multicolour "G" mark. Google's branding rules require it unchanged. */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cn('size-5 shrink-0', className)}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Google ile giriş yap" button, drawn to Google's sign-in branding: the "G" mark on the left,
 * white button with a grey border (dark theme: Google's dark button), Roboto when the device has it.
 * It is a plain link: the browser leaves the panel for the API, which redirects to Google.
 */
export function GoogleSignInLink({ className }: { className?: string }) {
  return (
    <a
      href={GOOGLE_SIGN_IN_HREF}
      className={cn(
        'inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-google-border bg-google-surface px-3 font-[family-name:Roboto,system-ui,sans-serif] text-sm font-medium text-google-ink no-underline hover:bg-[color-mix(in_oklch,var(--google-surface),var(--google-ink)_8%)]',
        className,
      )}
    >
      <GoogleMark />
      Google ile giriş yap
    </a>
  );
}
