import { useMatches } from '@tanstack/react-router';

export interface PageLocation {
  label: string;
  parent?: string;
}

/**
 * True when no page is on screen: no page matched, or the page failed to load. An address below a
 * known page (/c/armadx/tasks/123 with no such route) still matches that page with status
 * "success"; the router marks the route that shows the not found screen with `_notFound` instead.
 */
function pageMissing(
  matches: readonly { status: string; _notFound?: boolean | undefined }[],
): boolean {
  return matches.some(
    (match) => match.status === 'error' || match.status === 'notFound' || match._notFound === true,
  );
}

/**
 * The location declared by the page on screen (staticData.location of the deepest matched route).
 * Undefined when no page matched or the page failed to load: the not found and error screens bring
 * their own heading.
 */
export function usePageLocation(): PageLocation | undefined {
  return useMatches({
    select: (matches) =>
      pageMissing(matches)
        ? undefined
        : matches.findLast((match) => match.staticData.location)?.staticData.location,
  });
}

/**
 * True while the page on screen asked for the whole content area (staticData.fullBleed). Not while
 * it failed or was not found: those screens are ordinary padded pages, and "no page" is decided
 * exactly as for the location above.
 */
export function usePageFullBleed(): boolean {
  return useMatches({
    select: (matches) => !pageMissing(matches) && matches.at(-1)?.staticData.fullBleed === true,
  });
}
