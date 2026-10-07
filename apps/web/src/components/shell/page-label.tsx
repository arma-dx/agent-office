import { useLayoutEffect } from 'react';
import { useShell } from '@/lib/shell';

/**
 * The name of the record a detail page shows, for the top bar: <PageLabel>{task.title}</PageLabel>
 * anywhere inside the page. The top bar shows it as the page name (the h1) instead of the label the
 * route declares, for as long as this is mounted. It renders nothing itself.
 */
export function PageLabel({ children }: { children: string }) {
  const { registerPageLabel } = useShell();
  // A layout effect, as for the properties panel: the bar names the record in the same paint as the
  // page shows it.
  useLayoutEffect(() => registerPageLabel(children), [registerPageLabel, children]);
  return null;
}
