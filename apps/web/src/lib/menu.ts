import { Bot, CalendarDays, ClipboardCheck, ListTodo, NotebookText } from 'lucide-react';

/**
 * Sidebar menu. Every page lives under the company in the URL (/c/$company/...), so a link keeps
 * the company the person is working in. A row enters the menu together with its screen: "Yeni
 * talep" with the request form, "Ofis görünümü" with the Office view.
 */
export const MENU_SECTIONS = [
  {
    id: 'top',
    label: null,
    items: [
      { to: '/c/$company', label: 'Bugün', icon: CalendarDays, exact: true },
      { to: '/c/$company/approvals', label: 'Onaylar', icon: ClipboardCheck, exact: false },
    ],
  },
  {
    id: 'work',
    label: 'İş',
    items: [
      { to: '/c/$company/tasks', label: 'Görevler', icon: ListTodo, exact: false },
      { to: '/c/$company/notes', label: 'Notlar', icon: NotebookText, exact: false },
    ],
  },
  {
    id: 'office',
    label: 'Ofis',
    items: [{ to: '/c/$company/agents', label: 'Ajanlar', icon: Bot, exact: false }],
  },
] as const;

export type MenuItem = (typeof MENU_SECTIONS)[number]['items'][number];
