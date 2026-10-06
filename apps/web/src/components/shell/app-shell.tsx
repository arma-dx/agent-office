// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/Layout.tsx (the desktop frame, lines 620-766),
// ui/src/context/SidebarContext.tsx and ui/src/context/PanelContext.tsx at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: only the frame was kept (sidebar, top bar, content, properties panel) and the window
// stays the scroller, with the sidebar, the top bar and the panel sticky; one provider holds the
// sidebar and panel state; company sync, plugins, contextual sidebars, dialogs, shortcuts and the
// phone layout were removed.
import type { MembershipSummary } from '@agent-office/shared';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SkipLink } from '@/components/layout';
import { PanelRegion } from '@/components/shell/properties-panel';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import { usePageFullBleed } from '@/lib/location';
import { useCompany, useRememberCompany, useSession } from '@/lib/session';
import {
  PANEL_STORAGE_KEY,
  readStoredFlag,
  ShellContext,
  SIDEBAR_STORAGE_KEY,
  useShell,
  writeStoredFlag,
  type ShellValue,
} from '@/lib/shell';
import { cn } from '@/lib/utils';

/** Holds the layout state of the shell. The sidebar starts open, the properties panel closed. */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !readStoredFlag(SIDEBAR_STORAGE_KEY, 'closed'),
  );
  const [panelOpen, setPanelOpen] = useState(() => readStoredFlag(PANEL_STORAGE_KEY, 'open'));
  const [panelCount, setPanelCount] = useState(0);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);

  const toggleSidebar = useCallback(() => {
    writeStoredFlag(SIDEBAR_STORAGE_KEY, 'closed', sidebarOpen);
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen]);

  const togglePanel = useCallback(() => {
    writeStoredFlag(PANEL_STORAGE_KEY, 'open', !panelOpen);
    setPanelOpen(!panelOpen);
  }, [panelOpen]);

  const registerPanel = useCallback(() => {
    setPanelCount((count) => count + 1);
    return () => {
      setPanelCount((count) => count - 1);
    };
  }, []);

  const value = useMemo<ShellValue>(
    () => ({
      sidebarOpen,
      toggleSidebar,
      panelOpen,
      togglePanel,
      panelInUse: panelCount > 0,
      registerPanel,
      panelHost,
      setPanelHost,
    }),
    [sidebarOpen, toggleSidebar, panelOpen, togglePanel, panelCount, registerPanel, panelHost],
  );
  return <ShellContext value={value}>{children}</ShellContext>;
}

function ShellFrame({
  company,
  memberships,
  onSelectCompany,
}: {
  company: MembershipSummary;
  memberships: readonly MembershipSummary[];
  onSelectCompany: (code: string) => void;
}) {
  const { sidebarOpen } = useShell();
  // A page that fills the content area itself (the office view's canvas) gets no padding.
  const fullBleed = usePageFullBleed();
  return (
    // 1000 px, not 1024: a 1024 px window with a classic scrollbar leaves about 1008 px.
    <div className="flex min-h-dvh min-w-250 bg-surface text-ink">
      <SkipLink />
      {sidebarOpen ? (
        <Sidebar company={company} memberships={memberships} onSelectCompany={onSelectCompany} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex flex-1">
          {/* The window scrolls; the sidebar, the top bar and the properties panel stay in place. */}
          <main
            id="content"
            tabIndex={-1}
            className={cn('min-w-0 flex-1 scroll-mt-15', !fullBleed && 'p-6')}
          >
            {/* A new company starts with fresh page state (forms, notes); data is keyed by company too. */}
            <Outlet key={company.companyId} />
          </main>
          <PanelRegion />
        </div>
      </div>
    </div>
  );
}

/** The app shell inside a company: sidebar, top bar, content, properties panel. */
export function AppShell() {
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
    <ShellProvider>
      <ShellFrame
        company={company}
        memberships={session.memberships}
        onSelectCompany={selectCompany}
      />
    </ShellProvider>
  );
}
