// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/SidebarNavItem.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: TanStack Router link with typed paths and data-status styling, separate hover and
// selected tones, tokens instead of palette classes; the icon rail, tooltips, the live indicator
// and the phone drawer were removed; the badge is a plain count that is part of the link's name.
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { MenuItem } from '@/lib/menu';

/** One row of the sidebar menu. The router marks the open page (aria-current, data-status). */
export function SidebarNavItem({
  to,
  company,
  label,
  icon: Icon,
  exact,
  count = 0,
}: {
  to: MenuItem['to'];
  company: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
  /** How many things wait for the person behind this row; nothing is drawn at zero. */
  count?: number;
}) {
  return (
    <Link
      to={to}
      params={{ company }}
      activeOptions={{ exact }}
      className="mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[0.8125rem] font-medium text-ink not-data-[status=active]:hover:bg-sidebar-hover data-[status=active]:bg-sidebar-selected data-[status=active]:font-semibold"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 ? (
        <>
          <span aria-hidden="true" className="text-xs font-semibold tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
          <span className="sr-only">, {count} bekleyen</span>
        </>
      ) : null}
    </Link>
  );
}
