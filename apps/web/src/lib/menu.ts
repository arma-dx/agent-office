import type { Role } from '@agent-office/shared';
import {
  Bot,
  Building,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  Inbox,
  ListTodo,
  NotebookText,
} from 'lucide-react';

/** Who is offered a menu row: every member, or the founder and the employees only. */
export type MenuAudience = 'all' | 'insiders';

/** Where a row is offered: everywhere, or only in a company (not in Kurucu alanı). */
export type MenuSpace = 'any' | 'company';

/**
 * Sidebar menu. Every page lives under the company in the URL (/c/$company/...), so a link keeps
 * the company the person is working in. A row enters the menu together with its screen: "Ofis
 * görünümü" came with the office view, "Talepler" and the "Yeni talep" button with the request
 * flow, "Projeler" with the first step of the Projects section.
 */
export const MENU_SECTIONS = [
  {
    id: 'top',
    label: null,
    items: [
      {
        to: '/c/$company',
        label: 'Bugün',
        icon: CalendarDays,
        exact: true,
        audience: 'all',
        space: 'any',
      },
      {
        to: '/c/$company/approvals',
        label: 'Onaylar',
        icon: ClipboardCheck,
        exact: false,
        audience: 'all',
        space: 'any',
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
        space: 'any',
      },
      // Flow (B): the tasks people give to people. A different thing, on a row of its own.
      {
        to: '/c/$company/tasks',
        label: 'Görevler',
        icon: ListTodo,
        exact: false,
        audience: 'all',
        space: 'any',
      },
      {
        to: '/c/$company/notes',
        label: 'Notlar',
        icon: NotebookText,
        exact: false,
        audience: 'all',
        space: 'any',
      },
      // Offered to the founder and employees, in a company: no project is opened in Kurucu alanı.
      // Not exact: the row stays selected on a project's page.
      {
        to: '/c/$company/projects',
        label: 'Projeler',
        icon: FolderKanban,
        exact: false,
        audience: 'insiders',
        space: 'company',
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
        space: 'any',
      },
      {
        to: '/c/$company/agents',
        label: 'Ajanlar',
        icon: Bot,
        exact: false,
        audience: 'all',
        space: 'any',
      },
    ],
  },
] as const;

export type MenuItem = (typeof MENU_SECTIONS)[number]['items'][number];

/** True when a member with this role is offered the row in a space of this kind. */
export function isOfferedTo(
  item: { readonly audience: MenuAudience; readonly space: MenuSpace },
  company: { readonly role: Role; readonly kind: 'company' | 'private_space' },
): boolean {
  return (
    (item.audience === 'all' || company.role !== 'external') &&
    (item.space === 'any' || company.kind === 'company')
  );
}
