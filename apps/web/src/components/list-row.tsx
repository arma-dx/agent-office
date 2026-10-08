// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/IssueRow.tsx (the frame of the "task" row, lines 217-244) and
// ui/src/components/EntityRow.tsx (the leading, title, subtitle, meta and trailing slots) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: a list item; the title itself is the link and is stretched over the row, instead of a
// separate cover link with hidden text; typed TanStack Router link options instead of a string
// path; hover from a token, without a transition; no line between rows; the unread, checklist,
// tree and identifier parts, the selected state and the class overrides were removed.
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A dense row of a list: 36 px, 54 px with a subtitle; rows touch and have no line between them.
 * Goes inside a <ul>. With `link` the title is a link that covers the whole row; build it with
 * linkOptions() so the path is checked. Buttons inside the row stay above that cover and keep
 * their own click, so a row can hold controls (change the status, Onayla); a row with a 28 px
 * button takes className="py-1" to stay 36 px high. A second link inside the row needs
 * `relative z-10` on itself. `meta` sits right after the title, `trailing` is pinned to the right
 * edge; give time and number columns a fixed width and tabular figures. Plain text in `meta` and
 * `trailing` lies under the cover: a `title` attribute on it is never shown, so a column must be
 * wide enough for its text.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  link,
  className,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  link?: LinkProps;
  className?: string;
}) {
  return (
    <li
      className={cn(
        'relative flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm [&_button]:relative [&_button]:z-10',
        link && 'hover:bg-row-hover',
        className,
      )}
    >
      {leading ? <div className="flex shrink-0 items-center gap-2">{leading}</div> : null}
      <div className={cn('min-w-0', !meta && 'flex-1')}>
        <div className="truncate" title={title}>
          {link ? (
            // The cover (::after) is positioned against the row; index.css draws the focus ring on it.
            <Link {...link} className="row-link after:absolute after:inset-0 after:rounded-lg">
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-ink-secondary">{subtitle}</p> : null}
      </div>
      {meta ? (
        <>
          <div className="flex shrink-0 items-center gap-2">{meta}</div>
          <div className="flex-1" />
        </>
      ) : null}
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </li>
  );
}
