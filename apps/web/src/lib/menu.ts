import { CalendarDays, ClipboardCheck, Building2, ListTodo, NotebookText } from 'lucide-react';

/**
 * Main menu: bottom menu on phones, top bar on wide screens.
 * The "Ofis" tab opens the Agents screen until the Office view (module M15, November) arrives.
 */
export const MAIN_MENU = [
  { to: '/', label: 'Bugün', icon: CalendarDays },
  { to: '/approvals', label: 'Onaylar', icon: ClipboardCheck },
  { to: '/tasks', label: 'Görevler', icon: ListTodo },
  { to: '/notes', label: 'Notlar', icon: NotebookText },
  { to: '/agents', label: 'Ofis', icon: Building2 },
] as const;
