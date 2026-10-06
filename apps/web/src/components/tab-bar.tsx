// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/PageTabBar.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the phone branch (a native select) was removed; the tab list takes an accessible name.
import type { ReactNode } from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * The tab bar of a page, for sections inside one page. The page owns the surrounding <Tabs> (its
 * value) and renders one <TabsContent> per item. The bar is an inline group: put it in the
 * toolbar row of the page, next to the search box and the buttons.
 */
export function TabBar({
  items,
  label,
}: {
  items: readonly { value: string; label: ReactNode }[];
  /** Accessible name of the tab list, for example "Onay durumu". */
  label: string;
}) {
  return (
    <TabsList aria-label={label}>
      {items.map((item) => (
        <TabsTrigger key={item.value} value={item.value}>
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
