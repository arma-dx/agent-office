// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/SidebarNavItem.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: TanStack Router link with typed paths and data-status styling, separate hover and
// selected tones, tokens instead of palette classes; the icon rail, tooltips, badges, the live
// indicator and the phone drawer were removed.
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
}: {
  to: MenuItem['to'];
  company: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
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
    </Link>
  );
}
