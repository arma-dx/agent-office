import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; when Tailwind classes conflict, the last one wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * A control that is busy with a request stays focusable: `disabled` would drop the keyboard focus
 * to the page (and a screen reader's place with it), so the control is marked aria-disabled and its
 * handler ignores input while busy.
 */
export function busyProps(busy: boolean): { 'aria-disabled'?: true } {
  return busy ? { 'aria-disabled': true } : {};
}
