import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

/** Boş ekran ilk adımı gösterir (CLAUDE.md, arayüz metinleri). */
export function BosEkran({
  baslik,
  aciklama,
  eylem,
}: {
  baslik: string;
  aciklama: string;
  eylem?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-2 rounded-lg border border-cizgi bg-yuzey p-6">
      <h2 className="text-base font-semibold">{baslik}</h2>
      <p className="text-sm text-ikincil-metin">{aciklama}</p>
      {eylem ? <div className="pt-2">{eylem}</div> : null}
    </section>
  );
}

/** Hata mesajı ne olduğunu ve nasıl düzeleceğini söyler. */
export function HataMesaji({ mesaj, yenidenDene }: { mesaj: string; yenidenDene?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-hata/40 bg-yuzey p-4"
    >
      <p className="text-sm text-hata">{mesaj}</p>
      {yenidenDene ? (
        <Button variant="outline" onClick={yenidenDene}>
          Yeniden dene
        </Button>
      ) : null}
    </div>
  );
}

/** Yükleniyor durumu; ekran okuyucuya da söylenir. */
export function Yukleniyor({ satir = 3 }: { satir?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: satir }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
