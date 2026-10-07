import type { Role } from '@agent-office/shared';
import {
  Bot,
  Building,
  CalendarDays,
  ClipboardCheck,
  Inbox,
  ListTodo,
  NotebookText,
} from 'lucide-react';

/** Who is offered a menu row: every member, or the founder and the employees only. */
export type MenuAudience = 'all' | 'insiders';

/**
 * Sidebar menu. Every page lives under the company in the URL (/c/$company/...), so a link keeps
 * the company the person is working in. A row enters the menu together with its screen: "Ofis
 * görünümü" came with the office view, "Talepler" and the "Yeni talep" button with the request
 * flow.
 */
export const MENU_SECTIONS = [
  {
    id: 'top',
    label: null,
    items: [
      { to: '/c/$company', label: 'Bugün', icon: CalendarDays, exact: true, audience: 'all' },
      {
        to: '/c/$company/approvals',
        label: 'Onaylar',
        icon: ClipboardCheck,
        exact: false,
        audience: 'all',
      },
    ],
  },
  {
    id: 'work',
    label: 'İş',
    items: [
      // Flow (A): the requests agents carry out. Not offered to an external person, who has none.
      {
        to: '/c/$company/requests',
        label: 'Talepler',
        icon: Inbox,
        exact: false,
        audience: 'insiders',
      },
      // Flow (B): the tasks people give to people. A different thing, on a row of its own.
      { to: '/c/$company/tasks', label: 'Görevler', icon: ListTodo, exact: false, audience: 'all' },
      {
        to: '/c/$company/notes',
        label: 'Notlar',
        icon: NotebookText,
        exact: false,
        audience: 'all',
      },
    ],
  },
  {
    id: 'office',
    label: 'Ofis',
    items: [
      // Not offered to an external person: the API refuses them the office (insiders_only).
      {
        to: '/c/$company/office',
        label: 'Ofis görünümü',
        icon: Building,
        exact: false,
        audience: 'insiders',
      },
      { to: '/c/$company/agents', label: 'Ajanlar', icon: Bot, exact: false, audience: 'all' },
    ],
  },
] as const;

export type MenuItem = (typeof MENU_SECTIONS)[number]['items'][number];

/** True when a member with this role is offered the row. */
export function isOfferedTo(item: { readonly audience: MenuAudience }, role: Role): boolean {
  return item.audience === 'all' || role !== 'external';
}
