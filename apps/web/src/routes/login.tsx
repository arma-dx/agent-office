import { APP_NAME, loginStatusSchema, type LoginStatus } from '@agent-office/shared';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { GoogleSignInLink } from '@/components/google-sign-in';
import { GOOGLE_SIGN_IN_HREF } from '@/lib/session';
import { cn } from '@/lib/utils';

// An unknown status value is dropped instead of failing the page.
const loginSearchSchema = z.object({ status: loginStatusSchema.optional().catch(undefined) });

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { status?: LoginStatus | undefined } =>
    loginSearchSchema.parse(search),
  component: LoginScreen,
});

const MESSAGES: Record<LoginStatus, { text: string; tone: 'error' | 'info' }> = {
  denied: {
    text: 'Giriş tamamlanamadı. Davet edildiğiniz adresle girdiğinizden ve Google hesabınızda iki adımlı doğrulamanın açık olduğundan emin olup yeniden deneyin. Sorun sürerse sizi davet eden kişiye yazın.',
    tone: 'error',
  },
  unavailable: {
    text: 'Google ile giriş şu an kullanılamıyor. Birkaç dakika sonra yeniden deneyin; sorun sürerse sizi davet eden kişiye yazın.',
    tone: 'error',
  },
  expired: {
    text: 'Oturumunuz kapandı. Oturum 30 dakika işlem yapılmadığında ya da en geç 10 saat sonra kapanır. Devam etmek için yeniden giriş yapın.',
    tone: 'info',
  },
  signed_out: { text: 'Çıkış yaptınız.', tone: 'info' },
};

function LoginScreen() {
  const { status } = Route.useSearch();
  const message = status ? MESSAGES[status] : undefined;
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <main
        id="content"
        className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
          <p className="text-sm text-ink-secondary">
            Panele davetle girilir. Davet edildiğiniz Google hesabıyla giriş yapın.
          </p>
        </div>

        {message ? (
          <div
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'flex flex-col items-start gap-2 rounded-lg border bg-surface p-4 text-sm',
              message.tone === 'error' ? 'border-error/40 text-error' : 'border-line text-ink',
            )}
          >
            <p>{message.text}</p>
            {status === 'denied' ? (
              <a
                href={GOOGLE_SIGN_IN_HREF}
                className="font-medium text-brand underline underline-offset-4"
              >
                Başka hesapla gir
              </a>
            ) : null}
          </div>
        ) : null}

        <GoogleSignInLink />
      </main>
    </div>
  );
}
