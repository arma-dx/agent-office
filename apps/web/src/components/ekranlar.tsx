import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { kullaniciMesaji } from '@/lib/api';

/** Rota bulunamadığında gösterilir. */
export function BulunamadiEkrani() {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
      <p className="text-sm text-ikincil-metin">
        Açmaya çalıştığınız adres panelde yok. Menüden devam edebilirsiniz.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Bugün ekranına dön</Link>
      </Button>
    </section>
  );
}

/** Hata sınırı: bir ekran çökerse uygulamanın geri kalanı çalışmaya devam eder. */
export function HataEkrani({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Bu ekran açılamadı</h1>
      <p className="text-sm text-ikincil-metin">{kullaniciMesaji(error)}</p>
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
