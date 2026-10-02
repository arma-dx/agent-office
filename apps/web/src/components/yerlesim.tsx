import { UYGULAMA_ADI } from '@agent-office/shared';
import { Link, Outlet } from '@tanstack/react-router';
import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { GECICI_SIRKETLER, type SirketSecenegi } from '@/gecici-veri';
import { ANA_MENU } from '@/lib/menu';

/** Üst çubuktaki şirket seçici. Liste şimdilik geçici; giriş görevinde kullanıcının üyeliklerinden gelir. */
export function SirketSecici({
  secenekler,
  secili,
  sec,
}: {
  secenekler: readonly SirketSecenegi[];
  secili: string;
  sec: (kod: string) => void;
}) {
  const sirketler = secenekler.filter((s) => s.tur === 'sirket');
  const kurucuya = secenekler.filter((s) => s.tur !== 'sirket');
  const seciliAd = secenekler.find((s) => s.kod === secili)?.ad ?? 'Şirket seçin';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" aria-label={`Şirket: ${seciliAd}. Değiştir`}>
          {seciliAd}
          <ChevronsUpDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={secili} onValueChange={sec}>
          <DropdownMenuLabel>Şirket</DropdownMenuLabel>
          {sirketler.map((s) => (
            <DropdownMenuRadioItem key={s.kod} value={s.kod}>
              {s.ad}
            </DropdownMenuRadioItem>
          ))}
          {kurucuya.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Kurucu</DropdownMenuLabel>
              {kurucuya.map((s) => (
                <DropdownMenuRadioItem key={s.kod} value={s.kod}>
                  {s.ad}
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const menuBaglantisi =
  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ikincil-metin hover:text-metin data-[status=active]:font-medium data-[status=active]:text-vurgu';

/** Uygulamanın kabuğu: üst çubuk, içerik, telefonda alt menü. */
export function AnaYerlesim() {
  const ilk = GECICI_SIRKETLER[0]?.kod ?? '';
  const [secili, setSecili] = useState(ilk);
  return (
    <div className="min-h-dvh bg-zemin text-metin">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-yuzey focus:px-3 focus:py-2"
      >
        İçeriğe geç
      </a>
      <header className="sticky top-0 z-40 border-b border-cizgi bg-yuzey">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="text-base font-semibold">
            {UYGULAMA_ADI}
          </Link>
          <SirketSecici secenekler={GECICI_SIRKETLER} secili={secili} sec={setSecili} />
          <nav aria-label="Ana menü" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {ANA_MENU.map((m) => (
                <li key={m.to}>
                  <Link to={m.to} className={menuBaglantisi}>
                    {m.etiket}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="icerik" className="mx-auto scroll-mt-14 max-w-6xl px-4 pt-6 pb-24 md:pb-10">
        <Outlet />
      </main>

      <nav
        aria-label="Alt menü"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-cizgi bg-yuzey pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {ANA_MENU.map((m) => (
            <li key={m.to}>
              <Link
                to={m.to}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-ikincil-metin data-[status=active]:font-medium data-[status=active]:text-vurgu"
              >
                <m.ikon aria-hidden="true" className="size-5" />
                {m.etiket}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Toaster />
    </div>
  );
}
