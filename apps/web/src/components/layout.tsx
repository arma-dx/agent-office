import { APP_NAME } from '@agent-office/shared';
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
import { PLACEHOLDER_COMPANIES, type CompanyOption } from '@/placeholder-data';
import { MAIN_MENU } from '@/lib/menu';

/** Company switcher in the top bar. The list is temporary for now; in the login task it comes from the user's memberships. */
export function CompanySwitcher({
  options,
  selected,
  onSelect,
}: {
  options: readonly CompanyOption[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const companies = options.filter((o) => o.kind === 'company');
  const founderOptions = options.filter((o) => o.kind !== 'company');
  const selectedName = options.find((o) => o.code === selected)?.name ?? 'Şirket seçin';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" aria-label={`Şirket: ${selectedName}. Değiştir`}>
          {selectedName}
          <ChevronsUpDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
          <DropdownMenuLabel>Şirket</DropdownMenuLabel>
          {companies.map((o) => (
            <DropdownMenuRadioItem key={o.code} value={o.code}>
              {o.name}
            </DropdownMenuRadioItem>
          ))}
          {founderOptions.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Kurucu</DropdownMenuLabel>
              {founderOptions.map((o) => (
                <DropdownMenuRadioItem key={o.code} value={o.code}>
                  {o.name}
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const menuLinkClass =
  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-secondary hover:text-ink data-[status=active]:font-medium data-[status=active]:text-brand';

/** The app shell: top bar, content, bottom menu on phones. */
export function AppLayout() {
  const first = PLACEHOLDER_COMPANIES[0]?.code ?? '';
  const [selected, setSelected] = useState(first);
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        İçeriğe geç
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="text-base font-semibold">
            {APP_NAME}
          </Link>
          <CompanySwitcher
            options={PLACEHOLDER_COMPANIES}
            selected={selected}
            onSelect={setSelected}
          />
          <nav aria-label="Ana menü" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {MAIN_MENU.map((m) => (
                <li key={m.to}>
                  <Link to={m.to} className={menuLinkClass}>
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="content" className="mx-auto scroll-mt-14 max-w-6xl px-4 pt-6 pb-24 md:pb-10">
        <Outlet />
      </main>

      <nav
        aria-label="Alt menü"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {MAIN_MENU.map((m) => (
            <li key={m.to}>
              <Link
                to={m.to}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-ink-secondary data-[status=active]:font-medium data-[status=active]:text-brand"
              >
                <m.icon aria-hidden="true" className="size-5" />
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Toaster />
    </div>
  );
}
