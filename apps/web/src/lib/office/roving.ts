/**
 * Keyboard order of the office view. The items are the unit and agent buttons in DOM order: a unit,
 * then its agents, then the next unit. Only one of them is in the tab order at a time.
 */
export interface RovingItem {
  readonly id: string;
  readonly kind: 'unit' | 'agent';
}

/**
 * The item a key moves to, or null when the key does not move the focus.
 * Down and Up step through every item; Right jumps to the next unit; Left goes to the unit of the
 * current agent, or from a unit to the unit before it; Home and End go to the first and last item.
 */
export function nextItem(
  items: readonly RovingItem[],
  currentId: string,
  key: string,
): string | null {
  const index = items.findIndex((item) => item.id === currentId);
  if (index === -1) return null;
  let target: RovingItem | undefined;
  switch (key) {
    case 'ArrowDown':
      target = items[index + 1];
      break;
    case 'ArrowUp':
      target = index > 0 ? items[index - 1] : undefined;
      break;
    case 'ArrowRight':
      target = items.slice(index + 1).find((item) => item.kind === 'unit');
      break;
    case 'ArrowLeft':
      target = items.slice(0, index).findLast((item) => item.kind === 'unit');
      break;
    case 'Home':
      target = items[0];
      break;
    case 'End':
      target = items.at(-1);
      break;
    default:
      return null;
  }
  return target && target.id !== currentId ? target.id : null;
}
