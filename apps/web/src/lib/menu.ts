import { CalendarDays, ClipboardCheck, Building2, ListTodo, NotebookText } from 'lucide-react';

/**
 * Ana menü: telefonda alt menü, geniş ekranda üst çubuk.
 * "Ofis" sekmesi, Ofis görünümü (modül M15, Kasım) gelene kadar Ajanlar ekranını açar.
 */
export const ANA_MENU = [
  { to: '/', etiket: 'Bugün', ikon: CalendarDays },
  { to: '/onaylar', etiket: 'Onaylar', ikon: ClipboardCheck },
  { to: '/gorevler', etiket: 'Görevler', ikon: ListTodo },
  { to: '/notlar', etiket: 'Notlar', ikon: NotebookText },
  { to: '/ajanlar', etiket: 'Ofis', ikon: Building2 },
] as const;
