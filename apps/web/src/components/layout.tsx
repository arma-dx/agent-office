import { APP_NAME, type MembershipSummary } from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronsUpDown, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MAIN_MENU } from '@/lib/menu';
import { notifyError } from '@/lib/notify';
import { companyLabel, signOut, useCompany, useRememberCompany, useSession } from '@/lib/session';

/**
 * Company switcher in the top bar. The list is the person's memberships; the founder's private
 * space is listed apart under "Kurucu".
 */
export function CompanySwitcher({
  memberships,
  selected,
  onSelect,
}: {
  memberships: readonly MembershipSummary[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const companies = memberships.filter((m) => m.kind === 'company');
  const privateSpaces = memberships.filter((m) => m.kind === 'private_space');
  const current = memberships.find((m) => m.code === selected);
  const selectedName = current ? companyLabel(current) : 'Şirket seçin';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          className="max-w-44 min-w-0"
          aria-label={`Şirket: ${selectedName}. Değiştir`}
        >
          <span className="truncate">{selectedName}</span>
          <ChevronsUpDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48">
        <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
          {companies.length > 0 ? <DropdownMenuLabel>Şirket</DropdownMenuLabel> : null}
          {companies.map((m) => (
            <DropdownMenuRadioItem key={m.companyId} value={m.code}>
              {companyLabel(m)}
            </DropdownMenuRadioItem>
          ))}
          {privateSpaces.length > 0 ? (
            <>
              {companies.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>Kurucu</DropdownMenuLabel>
              {privateSpaces.map((m) => (
                <DropdownMenuRadioItem key={m.companyId} value={m.code}>
                  {companyLabel(m)}
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Signs out, clears every cached answer and opens the login screen with a short note. */
function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await navigate({ to: '/login', search: { status: 'signed_out' }, replace: true });
      queryClient.removeQueries();
    },
    onError: notifyError,
  });
}

/** The person's menu: name, settings for the founder, sign out. */
export function UserMenu({ company }: { company?: MembershipSummary }) {
  const session = useSession();
  const signOutMutation = useSignOut();
  const name = session.user.name;
  // Users are managed by the founder, inside a company (nobody is invited to the private space).
  const usersCompany =
    company?.role === 'founder' && company.kind === 'company' ? company : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="lg"
          className="max-w-48 min-w-0"
          aria-label={`Hesap: ${name}`}
        >
          <UserRound aria-hidden="true" className="sm:hidden" />
          <span className="hidden truncate sm:inline">{name}</span>
          <ChevronDown aria-hidden="true" className="hidden sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuLabel className="text-sm text-ink">{name}</DropdownMenuLabel>
        {usersCompany ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ayarlar</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/c/$company/settings/users" params={{ company: usersCompany.code }}>
                Kullanıcılar
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signOutMutation.isPending}
          onSelect={() => {
            signOutMutation.mutate('this');
          }}
        >
          Çıkış yap
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={signOutMutation.isPending}
          onSelect={() => {
            signOutMutation.mutate('all');
          }}
        >
          Bütün oturumları kapat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SkipLink() {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
    >
      İçeriğe geç
    </a>
  );
}

/** A page without the top bar: login screen and pages shown before the session is known. */
export function BarePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <main id="content" className="mx-auto max-w-6xl px-4 pt-6 pb-10">
        {children}
      </main>
    </div>
  );
}

/** Shown while the session is being checked. */
export function PageLoading() {
  return (
    <BarePage>
      <LoadingRows />
    </BarePage>
  );
}

/** A signed-in page outside a company (company picker, unknown company): name and user menu only. */
export function SignedInPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" activeOptions={{ exact: true }} className="text-base font-semibold">
            {APP_NAME}
          </Link>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="content" className="mx-auto scroll-mt-14 max-w-6xl px-4 pt-6 pb-10">
        {children}
      </main>
    </div>
  );
}

const menuLinkClass =
  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-secondary hover:text-ink data-[status=active]:font-medium data-[status=active]:text-brand';

/** The app shell inside a company: top bar, content, bottom menu on phones. */
export function AppLayout() {
  const session = useSession();
  const company = useCompany();
  const navigate = useNavigate();
  const rememberCompany = useRememberCompany();

  function selectCompany(code: string) {
    const target = session.memberships.find((m) => m.code === code);
    if (!target || target.code === company.code) return;
    // Same section, other company: /c/armadx/tasks becomes /c/pillika/tasks.
    void navigate({ to: '.', params: (previous) => ({ ...previous, company: target.code }) });
    rememberCompany.mutate(target.companyId);
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link
            to="/c/$company"
            params={{ company: company.code }}
            activeOptions={{ exact: true }}
            className="shrink-0 text-base font-semibold"
          >
            {APP_NAME}
          </Link>
          <CompanySwitcher
            memberships={session.memberships}
            selected={company.code}
            onSelect={selectCompany}
          />
          <nav aria-label="Ana menü" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {MAIN_MENU.map((m) => (
                <li key={m.to}>
                  <Link
                    to={m.to}
                    params={{ company: company.code }}
                    activeOptions={{ exact: m.exact }}
                    className={menuLinkClass}
                  >
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto shrink-0 md:ml-0">
            <UserMenu company={company} />
          </div>
        </div>
      </header>

      <main id="content" className="mx-auto scroll-mt-14 max-w-6xl px-4 pt-6 pb-24 md:pb-10">
        {/* A new company starts with fresh page state (forms, notes); data is keyed by company too. */}
        <Outlet key={company.companyId} />
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
                params={{ company: company.code }}
                activeOptions={{ exact: m.exact }}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-ink-secondary data-[status=active]:font-medium data-[status=active]:text-brand"
              >
                <m.icon aria-hidden="true" className="size-5" />
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
