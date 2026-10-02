import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Listelerde tek satır: başlık, altında ikincil bilgi, sağda durum ya da eylem. Ayrım çizgiyle. */
export function ListeSatiri({
  baslik,
  alt,
  sag,
  className,
}: {
  baslik: ReactNode;
  alt?: ReactNode;
  sag?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        'flex min-h-14 items-center justify-between gap-3 border-b border-cizgi px-4 py-3 last:border-b-0',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{baslik}</span>
        {alt ? <span className="truncate text-sm text-ikincil-metin">{alt}</span> : null}
      </div>
      {sag ? <div className="shrink-0">{sag}</div> : null}
    </li>
  );
}
