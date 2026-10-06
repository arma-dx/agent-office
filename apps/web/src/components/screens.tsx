import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { useOptionalCompany } from '@/lib/session';

/**
 * Shown when no route matches. Inside a company's shell the button stays in that company; "/"
 * would open the remembered one, which can be another company.
 */
export function NotFoundScreen() {
  const company = useOptionalCompany();
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
      <p className="text-sm text-ink-secondary">
        Açmaya çalıştığınız adres panelde yok. Menüden devam edebilirsiniz.
      </p>
      <Button asChild variant="outline">
        {company ? (
          <Link to="/c/$company" params={{ company: company.code }}>
            Bugün ekranına dön
          </Link>
        ) : (
          <Link to="/">Bugün ekranına dön</Link>
        )}
      </Button>
    </section>
  );
}

/** Error boundary: if one screen crashes, the rest of the app keeps working. */
export function ErrorScreen({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Bu ekran açılamadı</h1>
      <p className="text-sm text-ink-secondary">{userMessage(error)}</p>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Yeniden dene
      </Button>
    </section>
  );
}
