// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/BreadcrumbBar.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the location comes from the matched route (staticData) instead of a context set in
// effects; sentence-case labels; the bar is sticky because the window scrolls; a sidebar toggle at
// the right end, and the company name in the trail while the sidebar is hidden; the properties
// toggle shows on every page that uses the panel; plugin toolbars, task identifiers and the phone
// branches were removed.
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { PanelToggle } from '@/components/shell/properties-panel';
import { Button } from '@/components/ui/button';
import { usePageLocation } from '@/lib/location';
import { companyLabel, useOptionalCompany } from '@/lib/session';
import { SIDEBAR_ID, useShell } from '@/lib/shell';

const TRAIL_TEXT = 'shrink-0 text-sm font-medium text-ink-secondary';

function TrailSeparator() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-secondary" />;
}

/** Top bar button that hides or shows the sidebar. */
function SidebarToggle() {
  const { sidebarOpen, toggleSidebar } = useShell();
  const label = sidebarOpen ? 'Kenar çubuğunu gizle' : 'Kenar çubuğunu göster';
  return (
    <Button
      variant="ghost"
      size="icon"
      // aria-expanded would otherwise paint the ghost button as pressed while the sidebar is open.
      className="aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
      aria-label={label}
      title={label}
      aria-expanded={sidebarOpen}
      aria-controls={SIDEBAR_ID}
      onClick={toggleSidebar}
    >
      {sidebarOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
    </Button>
  );
}

/**
 * The top bar: where the person is, then the layout toggles at the right end. The page name is
 * the h1 of the page and starts on the same 24 px line as the content below. What comes before it
 * is plain text: the company while the sidebar (and with it the company menu) is hidden, and a
 * group without a page of its own ("Ayarlar"). A name on its own is a title (15 px, semibold); at
 * the end of a trail it takes the trail's type (14 px, medium).
 */
export function TopBar() {
  const location = usePageLocation();
  // The bar is also rendered outside the company layout in tests; without a company it names none.
  const company = useOptionalCompany();
  const { sidebarOpen } = useShell();
  const companyName = sidebarOpen || !company ? undefined : companyLabel(company);
  const inTrail = Boolean(companyName ?? location?.parent);
  return (
    <header className="sticky top-0 z-40 flex h-15 shrink-0 items-center gap-2 border-b border-line bg-surface px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {companyName ? <span className={TRAIL_TEXT}>{companyName}</span> : null}
        {companyName && location ? <TrailSeparator /> : null}
        {location?.parent ? (
          <>
            <span className={TRAIL_TEXT}>{location.parent}</span>
            <TrailSeparator />
          </>
        ) : null}
        {location ? (
          <h1
            className={
              inTrail
                ? 'min-w-0 truncate text-sm font-medium'
                : 'min-w-0 truncate text-[0.9375rem] font-semibold'
            }
          >
            {location.label}
          </h1>
        ) : null}
      </div>
      <SidebarToggle />
      <PanelToggle />
    </header>
  );
}
