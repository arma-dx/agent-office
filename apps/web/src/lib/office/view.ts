// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/pages/OrgChart.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501:
// clampZoom (lines 139-141), fitChartToViewport (143-163), zoom toward a point (323-352).
// License text: THIRD_PARTY_NOTICES.md.
// Changes: one view object instead of separate pan and zoom state, pure functions without the DOM,
// a box with its own origin, wheel steps that follow the size of the delta, limits 0.5 to 2.

/**
 * The view of the office scene: screen = scene * k + (x, y). Pure math, no DOM; the hook in
 * use-office-view.ts feeds it with pointer, wheel and key input.
 */
export interface View {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A box in scene pixels (the layout's bounds). */
export interface Box2 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const ZOOM = {
  min: 0.5,
  max: 2,
  /** One press of a zoom button or of the plus and minus keys. */
  step: 1.2,
  /** Fitting never enlarges the scene beyond its own size. */
  fitMax: 1,
  /** Free pixels kept around the scene when fitting. */
  fitPadding: 16,
  /** Pixels one arrow key press moves the scene; with Shift four times as far. */
  panStep: 48,
  /** Pixels of the scene that always stay inside the viewport. */
  keepVisible: 64,
} as const;

export const IDENTITY: View = { x: 0, y: 0, k: 1 };

export function clampZoom(k: number): number {
  return Math.min(Math.max(k, ZOOM.min), ZOOM.max);
}

/** Zooms by a factor and keeps the scene point under `anchor` (viewport pixels) where it is. */
export function zoomAt(view: View, anchor: Point, factor: number): View {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return {
    x: anchor.x - ratio * (anchor.x - view.x),
    y: anchor.y - ratio * (anchor.y - view.y),
    k,
  };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { x: view.x + dx, y: view.y + dy, k: view.k };
}

/**
 * The view that shows the whole box, centred. Null while the viewport has no usable size. The
 * offset is rounded to whole pixels: every vertex of the scene is a whole pixel, and at zoom 1 a
 * half pixel offset would smear every 1 pixel outline and every label border over two pixels.
 */
export function fitView(size: Size, box: Box2): View | null {
  const width = size.width - 2 * ZOOM.fitPadding;
  const height = size.height - 2 * ZOOM.fitPadding;
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const k = clampZoom(Math.min(width / box.width, height / box.height, ZOOM.fitMax));
  return {
    x: Math.round((size.width - box.width * k) / 2 - box.x * k),
    y: Math.round((size.height - box.height * k) / 2 - box.y * k),
    k,
  };
}

/**
 * Zoom factor of one wheel event. The size of the step follows the size of the delta, so a mouse
 * wheel notch and a stream of small trackpad deltas end at the same zoom. A trackpad pinch arrives
 * as a wheel event with ctrlKey set and small deltas (Chrome, Edge, Firefox), hence the larger gain.
 */
export function wheelFactor(event: {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}): number {
  // deltaMode: 0 pixels, 1 lines, 2 pages.
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
  const gain = event.ctrlKey ? 0.01 : 0.002;
  // One event never zooms by more than a factor of two, whatever the device reports.
  return Math.exp(Math.min(Math.max(-pixels * gain, -Math.LN2), Math.LN2));
}

/** How far a span from `low` to `high` has to move to lie between `min` and `max`; the low end wins when it does not fit. */
function shiftInto(low: number, high: number, min: number, max: number): number {
  const back = high > max ? max - high : 0;
  return low + back < min ? min - low : back;
}

/**
 * Pans as little as needed so that a box of the scene is inside the viewport, `margin` pixels from
 * its edge. A box larger than the viewport shows its top left corner.
 */
export function reveal(view: View, box: Box2, size: Size, margin: number): View {
  const left = box.x * view.k + view.x;
  const top = box.y * view.k + view.y;
  const dx = shiftInto(left, left + box.width * view.k, margin, size.width - margin);
  const dy = shiftInto(top, top + box.height * view.k, margin, size.height - margin);
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}

/** Limits the pan so the scene can never be dragged completely out of sight. */
export function keepInSight(view: View, size: Size, box: Box2): View {
  const left = box.x * view.k;
  const top = box.y * view.k;
  const minX = ZOOM.keepVisible - (left + box.width * view.k);
  const maxX = size.width - ZOOM.keepVisible - left;
  const minY = ZOOM.keepVisible - (top + box.height * view.k);
  const maxY = size.height - ZOOM.keepVisible - top;
  const x = Math.min(Math.max(view.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(view.y, minY), Math.max(minY, maxY));
  return x === view.x && y === view.y ? view : { x, y, k: view.k };
}
