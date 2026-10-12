import { GITHUB_ADDRESS_PREFIX } from '@agent-office/shared';
import type { ReactNode } from 'react';
import { TAB_TEXT } from '@/lib/github/labels';
import { cn } from '@/lib/utils';

const LINK = 'font-medium text-brand underline underline-offset-4';

/**
 * A link to a page on github.com: the only thing of the panel that leads there. The panel loads
 * nothing from GitHub and calls nothing there; a person presses the link, and it opens in a new
 * tab that knows nothing of the panel (no opener, no referrer). An address that is not on
 * github.com is no link: its text stays text.
 */
export function GithubLink({
  href,
  children,
  className,
}: {
  href: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!href?.startsWith(GITHUB_ADDRESS_PREFIX)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(LINK, className)}>
      {children}
      {/* The comma stands with the words: a screen reader reads one name without a gap in it. */}
      <span className="sr-only">, {TAB_TEXT.newTab}</span>
    </a>
  );
}
