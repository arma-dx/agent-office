/**
 * The HTML layer over the drawing: where each unit card and agent label is anchored, how much room
 * the scene needs once they are counted, and how much of a label is shown at a zoom level.
 * Pure math; the sizes of labels and cards are handed in, because only the browser knows them.
 */
import { project } from './iso.ts';
import type { OfficeLayout, SceneBounds } from './layout.ts';
import { agentId, unitId } from './model.ts';
import type { Size } from './view.ts';

export const OVERLAY = {
  /** The desk sprite (desk, monitor and figure seen from the front) stands on the centre of its cell. */
  spriteWidth: 48,
  spriteHeight: 44,
  /** Thickness of a room's slab on the screen, in scene pixels. */
  slab: 10,
  /** Free pixels between a sprite and its label. */
  labelGap: 4,
  /**
   * The ring of a desk (pointer, keyboard focus, selection) is drawn this far outside its sprite.
   * With half of its 2 pixel line it stays inside labelGap, so no label and no card lies over it.
   */
  ringPad: 2,
  /** The bottom edge of a unit card is this far above the top corner of its room. */
  cardLift: 24,
  /** Sizes assumed until the browser has measured a label or a card (and in tests): the largest allowed. */
  labelSize: { width: 224, height: 24 },
  cardSize: { width: 216, height: 65 },
  /** From this zoom up a label shows code and name. Below it labels stop shrinking and show the code only. */
  fullFrom: 0.85,
  /** Below this zoom agent labels are not shown; unit cards stay. */
  codeFrom: 0.6,
} as const;

export type DetailLevel = 'full' | 'code' | 'units';

/** How much text the labels carry at a zoom level. */
export function detailLevel(k: number): DetailLevel {
  if (k >= OVERLAY.fullFrom) return 'full';
  return k >= OVERLAY.codeFrom ? 'code' : 'units';
}

/**
 * Scale of labels and cards at a zoom level: they shrink with the scene down to fullFrom (13 pixel
 * text becomes 11) and never grow beyond their own size.
 */
export function overlayScale(k: number): number {
  return Math.min(Math.max(k, OVERLAY.fullFrom), 1);
}

/** Where an element of the overlay hangs: a point in scene pixels and the side it grows to. */
export interface OverlayAnchor {
  readonly id: string;
  /** card: centred above the point. above: grows up and to the right. below: grows down and to the left. */
  readonly placement: 'card' | 'above' | 'below';
  readonly x: number;
  readonly y: number;
}

/**
 * Anchors in reading order: a unit, then its agents. A label of the back row sits above its sprite
 * and grows to the right, one of the front row sits below and grows to the left, so two labels of
 * one room never meet.
 */
export function overlayAnchors(layout: OfficeLayout): OverlayAnchor[] {
  const anchors: OverlayAnchor[] = [];
  for (const room of layout.rooms) {
    const top = project(room.rect.x, room.rect.y);
    anchors.push({ id: unitId(room.unit), placement: 'card', x: top.x, y: top.y });
    for (const desk of room.desks) {
      const foot = project(desk.x, desk.y);
      const back = desk.row === 0;
      anchors.push({
        id: agentId(desk.agent),
        placement: back ? 'above' : 'below',
        x: foot.x + (back ? -1 : 1) * (OVERLAY.spriteWidth / 2),
        y: back ? foot.y - OVERLAY.spriteHeight : foot.y,
      });
    }
  }
  return anchors;
}

export interface OverlayBox extends SceneBounds {
  readonly id: string;
}

/** The box of an overlay element at zoom 1, from its anchor and its size. */
export function overlayBox(anchor: OverlayAnchor, size: Size): OverlayBox {
  const { width, height } = size;
  switch (anchor.placement) {
    case 'card':
      return {
        id: anchor.id,
        x: anchor.x - width / 2,
        y: anchor.y - OVERLAY.cardLift - height,
        width,
        height,
      };
    case 'above':
      return { id: anchor.id, x: anchor.x, y: anchor.y - OVERLAY.labelGap - height, width, height };
    case 'below':
      return { id: anchor.id, x: anchor.x - width, y: anchor.y + OVERLAY.labelGap, width, height };
  }
}

/** Boxes of all cards and labels at zoom 1; an element that was not measured yet takes the largest size. */
export function overlayBoxes(
  anchors: readonly OverlayAnchor[],
  sizes: ReadonlyMap<string, Size>,
): OverlayBox[] {
  return anchors.map((anchor) =>
    overlayBox(
      anchor,
      sizes.get(anchor.id) ?? (anchor.placement === 'card' ? OVERLAY.cardSize : OVERLAY.labelSize),
    ),
  );
}

/** Boxes of the desk sprites at zoom 1, for the clearance check. */
export function spriteBoxes(layout: OfficeLayout): OverlayBox[] {
  return layout.rooms.flatMap((room) =>
    room.desks.map((desk) => {
      const foot = project(desk.x, desk.y);
      return {
        id: `sprite:${desk.agent}`,
        x: foot.x - OVERLAY.spriteWidth / 2,
        y: foot.y - OVERLAY.spriteHeight,
        width: OVERLAY.spriteWidth,
        height: OVERLAY.spriteHeight,
      };
    }),
  );
}

/**
 * Boxes of the desk rings at zoom 1, for the clearance check: the sprite grown by ringPad and by
 * the half of the 2 pixel line that lies outside the path.
 */
export function ringBoxes(layout: OfficeLayout): OverlayBox[] {
  const grow = OVERLAY.ringPad + 1;
  return spriteBoxes(layout).map((sprite) => ({
    id: sprite.id.replace('sprite:', 'ring:'),
    x: sprite.x - grow,
    y: sprite.y - grow,
    width: sprite.width + 2 * grow,
    height: sprite.height + 2 * grow,
  }));
}

/** The box the view has to fit: every floor with its slab, every card and every label. */
export function sceneBounds(layout: OfficeLayout, boxes: readonly OverlayBox[]): SceneBounds {
  const floor = layout.floorBounds;
  let left = floor.x;
  let top = floor.y;
  let right = floor.x + floor.width;
  let bottom = floor.y + floor.height + OVERLAY.slab;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The part of the scene a unit or an agent takes at zoom 1: an agent's label and desk, a unit's
 * card and floor. The view keeps this box in sight for the selected and for the focused thing.
 */
export function extentOf(
  layout: OfficeLayout,
  boxes: readonly OverlayBox[],
  id: string,
): SceneBounds | null {
  const own = boxes.find((box) => box.id === id);
  if (!own) return null;
  const parts: SceneBounds[] = [own];
  for (const room of layout.rooms) {
    if (unitId(room.unit) === id) {
      const { x, y, w, d } = room.rect;
      const top = project(x, y);
      const left = project(x, y + d);
      const right = project(x + w, y);
      const bottom = project(x + w, y + d);
      parts.push({
        x: left.x,
        y: top.y,
        width: right.x - left.x,
        height: bottom.y + OVERLAY.slab - top.y,
      });
    }
    for (const desk of room.desks) {
      if (agentId(desk.agent) !== id) continue;
      const foot = project(desk.x, desk.y);
      parts.push({
        x: foot.x - OVERLAY.spriteWidth / 2,
        y: foot.y - OVERLAY.spriteHeight,
        width: OVERLAY.spriteWidth,
        height: OVERLAY.spriteHeight,
      });
    }
  }
  const left = Math.min(...parts.map((part) => part.x));
  const top = Math.min(...parts.map((part) => part.y));
  return {
    x: left,
    y: top,
    width: Math.max(...parts.map((part) => part.x + part.width)) - left,
    height: Math.max(...parts.map((part) => part.y + part.height)) - top,
  };
}

/** Free pixels between two boxes; 0 when they touch or overlap. */
export function clearance(a: SceneBounds, b: SceneBounds): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.max(dx, dy);
}

/**
 * Pairs that are closer than `minGap`. Two sprites are never a pair: desks of one room stand
 * behind each other by design.
 */
export function clashes(boxes: readonly OverlayBox[], minGap: number): [string, string][] {
  const isSprite = (box: OverlayBox) => box.id.startsWith('sprite:');
  const pairs: [string, string][] = [];
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      if (isSprite(a) && isSprite(b)) continue;
      if (clearance(a, b) < minGap) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}
