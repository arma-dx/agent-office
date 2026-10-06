// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/BreadcrumbBar.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the location comes from the matched route (staticData) instead of a context set in
// effects; sentence-case labels; the bar is sticky because the window scrolls; the properties
// toggle shows on every page that uses the panel; plugin toolbars, task identifiers and the phone
// branches were removed.
import { ChevronRight } from 'lucide-react';
import { PanelToggle } from '@/components/shell/properties-panel';
import { usePageLocation } from '@/lib/location';

const TRAIL_TEXT = 'shrink-0 text-sm font-medium text-ink-secondary';

function TrailSeparator() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-secondary" />;
}

/**
 * The top bar: where the person is, then the properties toggle at the right end. The page name is
 * the h1 of the page and starts on the same 24 px line as the content below. A group without a
 * page of its own ("Ayarlar") is plain text before it. A name on its own is a title (15 px,
 * semibold); at the end of a trail it takes the trail's type (14 px, medium).
 */
export function TopBar() {
  const location = usePageLocation();
  const inTrail = Boolean(location?.parent);
  return (
    <header className="sticky top-0 z-40 flex h-15 shrink-0 items-center gap-2 border-b border-line bg-surface px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
                : 'min-w-0 truncate text-[15px] font-semibold'
            }
          >
            {location.label}
          </h1>
        ) : null}
      </div>
      <PanelToggle />
    </header>
  );
}
