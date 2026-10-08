// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/Sidebar.tsx, ui/src/components/SidebarSection.tsx and
// ui/src/components/primary-sidebar-styles.ts at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: our menu (lib/menu.ts) instead of Paperclip's routes, queries and plugin outlets, with
// rows that only some roles are offered; sentence-case group labels in the secondary text color;
// groups do not collapse; the sidebar is sticky because the window scrolls.
import type { MembershipSummary } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useOpenRequestDialog } from '@/lib/requests/dialog';
import { AccountMenu } from '@/components/shell/account-menu';
import { CompanyMenu } from '@/components/shell/company-menu';
import { SidebarNavItem } from '@/components/shell/sidebar-nav-item';
import { isOfferedTo, MENU_SECTIONS } from '@/lib/menu';
import { useBackgroundRefresh } from '@/lib/refresh';
import { decisionDialogOpen } from '@/lib/requests/hold';
import { approvalDeskQueryOptions, fetchApprovalDesk } from '@/lib/requests/query';
import { SIDEBAR_ID } from '@/lib/shell';

/**
 * How many decisions wait for the person in this company: results they may decide and results of
 * their own requests that wait for acceptance. The same answer the Onaylar screen shows, refreshed
 * in the background.
 */
function useWaitingCount(company: MembershipSummary): number {
  const insider = company.role !== 'external';
  const options = approvalDeskQueryOptions(company.companyId);
  const desk = useQuery({ ...options, enabled: insider });
  useBackgroundRefresh({
    queryKey: options.queryKey,
    fetch: (signal) => fetchApprovalDesk(company.companyId, { signal, background: true }),
    // The Onaylar screen draws its cards from this answer: not under an open decision dialog.
    paused: decisionDialogOpen,
  });
  return desk.data ? desk.data.approvals.length + desk.data.acceptances.length : 0;
}

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
  const openRequest = useOpenRequestDialog();
  const waiting = useWaitingCount(company);
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
        {/* The one global entry is the one for agent work; a task between people is created on
            its own screen. */}
        {openRequest ? (
          <button
            type="button"
            onClick={openRequest}
            className="mx-2 flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-left text-[0.8125rem] font-medium text-ink hover:bg-sidebar-hover"
          >
            <Plus aria-hidden="true" className="size-4 shrink-0" />
            Yeni talep
          </button>
        ) : null}
        {MENU_SECTIONS.map((section) => (
          <SidebarSection key={section.id} label={section.label}>
            {section.items
              .filter((item) => isOfferedTo(item, company.role))
              .map((item) => (
                <li key={item.to}>
                  <SidebarNavItem
                    to={item.to}
                    company={company.code}
                    label={item.label}
                    icon={item.icon}
                    exact={item.exact}
                    count={item.to === '/c/$company/approvals' ? waiting : 0}
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
