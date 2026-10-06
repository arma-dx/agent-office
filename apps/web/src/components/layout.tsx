import { APP_NAME } from '@agent-office/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/shell/account-menu';
import { LoadingRows } from '@/components/states';

/** First stop of the keyboard: jumps over the menus to the content. */
export function SkipLink() {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
    >
      İçeriğe geç
    </a>
  );
}

/** A page without any menu: pages shown before the session is known, and not found outside a company. */
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

/** A signed-in page outside a company (company picker, unknown company): name and account menu only. */
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
            <AccountMenu placement="header" />
          </div>
        </div>
      </header>
      <main id="content" className="mx-auto scroll-mt-14 max-w-6xl px-4 pt-6 pb-10">
        {children}
      </main>
    </div>
  );
}
