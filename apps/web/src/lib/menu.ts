import { CalendarDays, ClipboardCheck, Building2, ListTodo, NotebookText } from 'lucide-react';

/**
 * Main menu: bottom menu on phones, top bar on wide screens. Every page lives under the company
 * in the URL (/c/$company/...), so a link keeps the company the person is working in.
 * The "Ofis" tab opens the Agents screen until the Office view (module M15, November) arrives.
 */
export const MAIN_MENU = [
  { to: '/c/$company', label: 'Bugün', icon: CalendarDays, exact: true },
  { to: '/c/$company/approvals', label: 'Onaylar', icon: ClipboardCheck, exact: false },
  { to: '/c/$company/tasks', label: 'Görevler', icon: ListTodo, exact: false },
  { to: '/c/$company/notes', label: 'Notlar', icon: NotebookText, exact: false },
  { to: '/c/$company/agents', label: 'Ofis', icon: Building2, exact: false },
] as const;
