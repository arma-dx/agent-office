import { useEffect, useRef, type FocusEvent, type RefObject } from 'react';

/**
 * Keeps the keyboard's place in a list whose rows come and go by themselves. Rows are keyed by
 * id, so a row that stays keeps its element and the focus on it. When the row that held the focus
 * is removed (a refresh took the item away), the focus would fall to the page and the next Tab
 * would start from the top: it goes to the heading of the list instead, without scrolling.
 * Nothing is moved when the focus is somewhere else by then.
 *
 * `signature` changes when the rows change (their ids, joined). Put the two handlers on the list
 * and the ref on its heading (tabIndex -1). A list that is replaced by an empty state when its
 * last row leaves puts the same ref on the heading of that state.
 */
export function useRowFocus(signature: string): {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
} {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const row = useRef<Element | null>(null);
  useEffect(() => {
    const last = row.current;
    if (last === null || last.isConnected) return;
    row.current = null;
    if (document.activeElement === document.body) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [signature]);
  const onFocusCapture = (event: FocusEvent<HTMLElement>): void => {
    row.current = event.target.closest('li');
  };
  const onBlurCapture = (event: FocusEvent<HTMLElement>): void => {
    // The person moved on to another control. A blur with no next element (the row was removed,
    // the window lost the focus) keeps the note for the effect above.
    if (event.relatedTarget !== null) row.current = null;
  };
  return { headingRef, onFocusCapture, onBlurCapture };
}
