// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/SidebarCompanyMenu.tsx (trigger, lines 258-292) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: only the trigger layout was taken; the menu is our radio list of memberships. Reordering,
// creating, inviting, signing out and the generated company pattern were removed.
import type { MembershipSummary } from '@agent-office/shared';
import { ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { companyLabel } from '@/lib/session';
import { initials } from '@/lib/utils';

/**
 * Company menu at the top of the sidebar. The list is the person's memberships; the founder's
 * private space is listed apart under "Kurucu". The 36 px trigger puts its letter tile on the icon
 * column of the menu rows.
 */
export function CompanyMenu({
  memberships,
  selected,
  onSelect,
}: {
  memberships: readonly MembershipSummary[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const companies = memberships.filter((m) => m.kind === 'company');
  const privateSpaces = memberships.filter((m) => m.kind === 'private_space');
  const current = memberships.find((m) => m.code === selected);
  const selectedName = current ? companyLabel(current) : 'Şirket seçin';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Şirket: ${selectedName}. Değiştir`}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-4 text-left hover:bg-sidebar-hover aria-expanded:bg-sidebar-hover"
        >
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-md bg-brand text-[0.625rem] font-semibold text-on-brand"
          >
            {initials(selectedName)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selectedName}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-ink-secondary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-62">
        <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
          {companies.length > 0 ? <DropdownMenuLabel>Şirket</DropdownMenuLabel> : null}
          {companies.map((m) => (
            <DropdownMenuRadioItem key={m.companyId} value={m.code}>
              {companyLabel(m)}
            </DropdownMenuRadioItem>
          ))}
          {privateSpaces.length > 0 ? (
            <>
              {companies.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>Kurucu</DropdownMenuLabel>
              {privateSpaces.map((m) => (
                <DropdownMenuRadioItem key={m.companyId} value={m.code}>
                  {companyLabel(m)}
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
