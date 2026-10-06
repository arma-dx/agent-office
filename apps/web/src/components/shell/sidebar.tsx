// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/Sidebar.tsx, ui/src/components/SidebarSection.tsx and
// ui/src/components/primary-sidebar-styles.ts at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: our menu (lib/menu.ts) instead of Paperclip's routes, queries and plugin outlets;
// sentence-case group labels in the secondary text color; groups do not collapse; the sidebar is
// sticky because the window scrolls.
import type { MembershipSummary } from '@agent-office/shared';
import { useId, type ReactNode } from 'react';
import { AccountMenu } from '@/components/shell/account-menu';
import { CompanyMenu } from '@/components/shell/company-menu';
import { SidebarNavItem } from '@/components/shell/sidebar-nav-item';
import { MENU_SECTIONS } from '@/lib/menu';
import { SIDEBAR_ID } from '@/lib/shell';

/** A group of menu rows; a labelled group names its list after the label. */
function SidebarSection({ label, children }: { label: string | null; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className="flex flex-col">
      {label ? (
        <div id={labelId} className="px-4 pt-2 pb-1.5 text-xs font-medium text-ink-secondary">
          {label}
        </div>
      ) : null}
      <ul aria-labelledby={label ? labelId : undefined} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}

/**
 * The sidebar: company menu on top, the menu in the middle (the only part that scrolls), account
 * menu at the bottom. 240 px wide, as high as the window, 60 px header, rows on a 28 px icon
 * column, 24 px above a group label and 6 px below it.
 */
export function Sidebar({
  company,
  memberships,
  onSelectCompany,
}: {
  company: MembershipSummary;
  memberships: readonly MembershipSummary[];
  onSelectCompany: (code: string) => void;
}) {
  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Kenar çubuğu"
      className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col bg-sidebar"
    >
      <div className="flex h-15 shrink-0 items-center px-3">
        <CompanyMenu memberships={memberships} selected={company.code} onSelect={onSelectCompany} />
      </div>
      <nav
        aria-label="Ana menü"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-2"
      >
        {MENU_SECTIONS.map((section) => (
          <SidebarSection key={section.id} label={section.label}>
            {section.items.map((item) => (
              <li key={item.to}>
                <SidebarNavItem
                  to={item.to}
                  company={company.code}
                  label={item.label}
                  icon={item.icon}
                  exact={item.exact}
                />
              </li>
            ))}
          </SidebarSection>
        ))}
      </nav>
      <div className="shrink-0 px-5 py-2">
        <AccountMenu company={company} placement="sidebar" />
      </div>
    </aside>
  );
}
