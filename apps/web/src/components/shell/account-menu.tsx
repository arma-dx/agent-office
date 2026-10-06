// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/SidebarAccountMenu.tsx (strip and trigger, lines 172-189) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: only the trigger layout was taken; the menu stays a dropdown menu (role menu) with our
// items. The profile link, invitations, documentation, feedback and server details were removed.
import type { MembershipSummary } from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { notifyError } from '@/lib/notify';
import { signOut, useSession } from '@/lib/session';
import { setThemeChoice, THEME_CHOICES, themeChoiceSchema, useThemeChoice } from '@/lib/theme';
import { initials } from '@/lib/utils';

/** Signs out, clears every cached answer and opens the login screen with a short note. */
function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await navigate({ to: '/login', search: { status: 'signed_out' }, replace: true });
      queryClient.removeQueries();
    },
    onError: notifyError,
  });
}

/**
 * The person's menu: name, settings (users for the founder, security for everyone), theme, sign
 * out. At the bottom of the sidebar it is a menu row with a 24 px avatar and opens upward; in the
 * header of a page outside a company it opens downward.
 */
export function AccountMenu({
  company,
  placement,
}: {
  company?: MembershipSummary;
  placement: 'sidebar' | 'header';
}) {
  const session = useSession();
  const signOutMutation = useSignOut();
  const themeChoice = useThemeChoice();
  const name = session.user.name;
  // Users are managed by the founder, inside a company (nobody is invited to the private space).
  const usersCompany =
    company?.role === 'founder' && company.kind === 'company' ? company : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {placement === 'sidebar' ? (
          <button
            type="button"
            aria-label={`Hesap: ${name}`}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium hover:bg-sidebar-hover aria-expanded:bg-sidebar-hover"
          >
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-full bg-sidebar-selected text-[11px] font-semibold"
            >
              {initials(name)}
            </span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </button>
        ) : (
          <Button
            variant="ghost"
            size="lg"
            className="max-w-48 min-w-0"
            aria-label={`Hesap: ${name}`}
          >
            <span className="truncate">{name}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={placement === 'sidebar' ? 'top' : 'bottom'}
        align={placement === 'sidebar' ? 'start' : 'end'}
        sideOffset={8}
        className="w-62"
      >
        <DropdownMenuLabel className="text-sm text-ink">{name}</DropdownMenuLabel>
        {company ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ayarlar</DropdownMenuLabel>
            {usersCompany ? (
              <DropdownMenuItem asChild>
                <Link to="/c/$company/settings/users" params={{ company: usersCompany.code }}>
                  Kullanıcılar
                </Link>
              </DropdownMenuItem>
            ) : null}
            {/* Passkeys belong to the person; the page opens under the company in the URL. */}
            <DropdownMenuItem asChild>
              <Link to="/c/$company/settings/security" params={{ company: company.code }}>
                Güvenlik
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={themeChoice}
          onValueChange={(value) => {
            setThemeChoice(themeChoiceSchema.parse(value));
          }}
        >
          {THEME_CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signOutMutation.isPending}
          onSelect={() => {
            signOutMutation.mutate('this');
          }}
        >
          Çıkış yap
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={signOutMutation.isPending}
          onSelect={() => {
            signOutMutation.mutate('all');
          }}
        >
          Bütün oturumları kapat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
