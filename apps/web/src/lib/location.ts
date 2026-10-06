import { useMatches } from '@tanstack/react-router';

export interface PageLocation {
  label: string;
  parent?: string;
}

/**
 * The location declared by the page on screen (staticData.location of the deepest matched route).
 * Undefined when no page matched or the page failed to load: the not found and error screens bring
 * their own heading.
 */
export function usePageLocation(): PageLocation | undefined {
  return useMatches({
    select: (matches) => {
      if (matches.some((match) => match.status === 'error' || match.status === 'notFound')) {
        return undefined;
      }
      return matches.findLast((match) => match.staticData.location)?.staticData.location;
    },
  });
}
