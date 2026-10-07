// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/BreadcrumbBar.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the location comes from the matched route (staticData) instead of a context set in
// effects; sentence-case labels; the bar is sticky because the window scrolls; a sidebar toggle at
// the right end, and the company name in the trail while the sidebar is hidden; the properties
// toggle shows on every page that uses the panel; plugin toolbars, task identifiers and the phone
// branches were removed; a detail page names its record (lib/shell.ts, pageLabel) and links back
// to the page it belongs to.
import { Link } from '@tanstack/react-router';
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
 * the h1 of the page and starts on the same 24 px line as the content below; on a detail page it
 * is the name of the record (<PageLabel>), and the label the route declares until the record is
 * known. What comes before it: the company while the sidebar (and with it the company menu) is
 * hidden, then a group without a page of its own as plain text ("Ayarlar") or the page a detail
 * page belongs to as a link back ("Görevler"). A name on its own is a title (15 px, semibold); at
 * the end of a trail it takes the trail's type (14 px, medium).
 */
export function TopBar() {
  const location = usePageLocation();
  // The bar is also rendered outside the company layout in tests; without a company it names none.
  const company = useOptionalCompany();
  const { sidebarOpen, pageLabel } = useShell();
  const companyName = sidebarOpen || !company ? undefined : companyLabel(company);
  const parent = location?.parent;
  const inTrail = Boolean(companyName ?? parent);
  return (
    <header className="sticky top-0 z-40 flex h-15 shrink-0 items-center gap-2 border-b border-line bg-surface px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {companyName ? <span className={TRAIL_TEXT}>{companyName}</span> : null}
        {companyName && location ? <TrailSeparator /> : null}
        {parent ? (
          <>
            {typeof parent === 'string' || !company ? (
              <span className={TRAIL_TEXT}>
                {typeof parent === 'string' ? parent : parent.label}
              </span>
            ) : (
              <Link
                to={parent.to}
                params={{ company: company.code }}
                // The page on screen is the record, not the page this link leads back to.
                activeOptions={{ exact: true }}
                className={`${TRAIL_TEXT} rounded-sm hover:text-ink hover:underline`}
              >
                {parent.label}
              </Link>
            )}
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
            {pageLabel ?? location.label}
          </h1>
        ) : null}
      </div>
      <SidebarToggle />
      <PanelToggle />
    </header>
  );
}
