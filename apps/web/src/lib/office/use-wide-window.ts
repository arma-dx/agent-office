import { useSyncExternalStore } from 'react';

/**
 * The window width from which the office view asks for the properties panel beside the scene. The
 * panel takes 320 px: below this width it would leave a canvas too narrow for the office (464 px
 * in a 1024 px window), so there the panel follows the person's own choice.
 */
export const WIDE_WINDOW_QUERY = '(min-width: 1280px)';

function subscribe(listener: () => void): () => void {
  const query = window.matchMedia(WIDE_WINDOW_QUERY);
  query.addEventListener('change', listener);
  return () => {
    query.removeEventListener('change', listener);
  };
}

function isWide(): boolean {
  return window.matchMedia(WIDE_WINDOW_QUERY).matches;
}

/** True while the window is at least 1280 px wide; follows the window as it is resized. */
export function useWideWindow(): boolean {
  return useSyncExternalStore(subscribe, isWide);
}
