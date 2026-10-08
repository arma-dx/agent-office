// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/ProjectTile.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the colour and the icon come from the two fixed sets of the shared contract and are
// drawn with token classes instead of an inline style and a free Lucide name; two sizes; the
// glyph takes the surface colour, so it holds in both themes; always decorative.
import type { ProjectColor, ProjectIcon } from '@agent-office/shared';
import { PROJECT_FILL, PROJECT_ICON } from '@/lib/projects/labels';
import { cn } from '@/lib/utils';

const SIZE = {
  sm: { box: 'size-6 rounded-md', icon: 'size-3.5' },
  md: { box: 'size-8 rounded-lg', icon: 'size-4' },
} as const;

/**
 * The tile of a project: its colour as a filled square with its icon on it. It is the identity of
 * the project, not a state: no status is ever a filled square. The tile is the one place the
 * project icon is drawn; it is never a control, and the colour and the icon are named in words
 * where they matter (the properties of the project page).
 */
export function ProjectTile({
  color,
  icon,
  size = 'sm',
  className,
}: {
  color: ProjectColor;
  icon: ProjectIcon;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const Icon = PROJECT_ICON[icon];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-surface',
        SIZE[size].box,
        PROJECT_FILL[color],
        className,
      )}
    >
      <Icon className={SIZE[size].icon} />
    </span>
  );
}
