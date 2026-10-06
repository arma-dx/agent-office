/**
 * Isometric projection for the office view: world grid to scene pixels, box faces and paint order.
 * Scene pixels are the coordinates inside the panned and zoomed group; the view transform is applied
 * on top of them (see view.ts).
 */

/**
 * Scene pixels per world unit at zoom 1. One world unit is one floor tile, a 32 x 16 pixel diamond.
 * With the 2:1 ratio every vertex on a half-tile step is a whole pixel, so 1 pixel outlines stay sharp.
 */
export const ISO = { halfWidth: 16, halfHeight: 8, rise: 16 } as const;

/** A point in scene pixels. */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box on the world grid: x and y on the floor, z up; w along x, d along y, h along z. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** The three faces the viewer sees, and the silhouette, each as a value for the SVG points attribute. */
export interface BoxFaces {
  readonly top: string;
  readonly left: string;
  readonly right: string;
  readonly outline: string;
}

/** World grid to scene pixels. x runs to the lower right of the screen, y to the lower left, z straight up. */
export function project(x: number, y: number, z = 0): ScenePoint {
  return {
    x: (x - y) * ISO.halfWidth,
    y: (x + y) * ISO.halfHeight - z * ISO.rise,
  };
}

/** Scene pixels back to the floor (z = 0) of the world grid. */
export function unproject(point: ScenePoint): { x: number; y: number } {
  const a = point.x / ISO.halfWidth;
  const b = point.y / ISO.halfHeight;
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

function round(value: number): number {
  // Two decimals are below a device pixel at every zoom level we allow; -0 is written as 0.
  return Math.round(value * 100) / 100 + 0;
}

/** Value for the SVG points attribute. */
export function toPoints(points: readonly ScenePoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/** Faces of a box as seen from the fixed viewpoint (the viewer looks toward smaller x and y). */
export function boxFaces(box: Box): BoxFaces {
  const { x, y, z, w, d, h } = box;
  const top = z + h;
  const back = project(x, y, top);
  const right = project(x + w, y, top);
  const front = project(x + w, y + d, top);
  const left = project(x, y + d, top);
  const rightFoot = project(x + w, y, z);
  const frontFoot = project(x + w, y + d, z);
  const leftFoot = project(x, y + d, z);
  return {
    top: toPoints([back, right, front, left]),
    right: toPoints([right, front, frontFoot, rightFoot]),
    left: toPoints([left, front, frontFoot, leftFoot]),
    outline: toPoints([back, right, rightFoot, frontFoot, leftFoot, left]),
  };
}

/**
 * Painter's order for things of equal footprint on one grid (desks on a platform, platforms on the
 * slot grid): a smaller x + y is farther from the viewer and is painted first. Ties cannot hide each
 * other; they are ordered by x so the DOM order stays the same between renders.
 */
export function byDepth(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return a.x + a.y - (b.x + b.y) || a.x - b.x;
}
