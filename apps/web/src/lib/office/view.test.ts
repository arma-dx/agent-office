import { describe, expect, it } from 'vitest';
import { detailLevel } from './overlay.ts';
import {
  clampZoom,
  fitView,
  IDENTITY,
  keepInSight,
  panBy,
  reveal,
  wheelFactor,
  ZOOM,
  zoomAt,
} from './view.ts';

const SIZE = { width: 1000, height: 600 };
// Taller than the viewport allows at zoom 1, so fitting has to shrink it.
const BOX = { x: -480, y: -296, width: 960, height: 640 };

describe('clampZoom', () => {
  it('keeps the zoom between the two limits', () => {
    expect(clampZoom(0.01)).toBe(ZOOM.min);
    expect(clampZoom(99)).toBe(ZOOM.max);
    expect(clampZoom(1.2)).toBe(1.2);
  });
});

describe('zoomAt', () => {
  it('keeps the scene point under the anchor where it is', () => {
    const before = { x: 120, y: -40, k: 0.8 };
    const anchor = { x: 300, y: 200 };
    const after = zoomAt(before, anchor, 1.5);
    const sceneX = (anchor.x - before.x) / before.k;
    const sceneY = (anchor.y - before.y) / before.k;
    expect(sceneX * after.k + after.x).toBeCloseTo(anchor.x, 10);
    expect(sceneY * after.k + after.y).toBeCloseTo(anchor.y, 10);
    expect(after.k).toBeCloseTo(1.2, 10);
  });

  it('does not move the view once the limit is reached', () => {
    const atMax = { x: 10, y: 20, k: ZOOM.max };
    expect(zoomAt(atMax, { x: 500, y: 300 }, 2)).toEqual(atMax);
  });
});

describe('fitView', () => {
  it('centres the box and leaves the padding free', () => {
    const view = fitView(SIZE, BOX);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.k).toBeCloseTo((600 - 2 * ZOOM.fitPadding) / 640, 10);
    // Centred to the pixel: the offset itself is a whole number (see the next test).
    const left = BOX.x * view.k + view.x;
    const right = (BOX.x + BOX.width) * view.k + view.x;
    expect(Math.abs(left - (SIZE.width - right))).toBeLessThanOrEqual(1);
    const top = BOX.y * view.k + view.y;
    expect(Math.abs(top - ZOOM.fitPadding)).toBeLessThanOrEqual(0.5);
  });

  it('puts the scene on whole pixels, so 1 pixel outlines stay sharp at zoom 1', () => {
    // A scene of odd width in a viewport of even width would sit on half a pixel.
    const view = fitView(
      { width: 1040, height: 740 },
      { x: -122.5, y: -97, width: 245, height: 194 },
    );
    expect(view).toEqual({ x: 520, y: 370, k: 1 });
    const scaled = fitView(SIZE, BOX);
    expect(Number.isInteger(scaled?.x)).toBe(true);
    expect(Number.isInteger(scaled?.y)).toBe(true);
  });

  it('never enlarges a small scene beyond fitMax', () => {
    expect(fitView({ width: 4000, height: 3000 }, BOX)?.k).toBe(ZOOM.fitMax);
  });

  it('never goes below the minimum zoom for a huge scene', () => {
    expect(fitView(SIZE, { x: 0, y: 0, width: 90000, height: 90000 })?.k).toBe(ZOOM.min);
  });

  it('returns null while the viewport has no usable size', () => {
    expect(fitView({ width: 0, height: 0 }, BOX)).toBeNull();
    expect(fitView({ width: 2 * ZOOM.fitPadding, height: 600 }, BOX)).toBeNull();
  });
});

describe('the first view of the Arma DX office, by window', () => {
  // The scene as Chrome measured it with the real label sizes: 890 x 646 pixels at zoom 1.
  const SCENE = { x: -445, y: -323, width: 890, height: 646 };
  // The canvas is the window less the 240 pixel sidebar and the 60 pixel top bar.
  const canvasOf = (width: number, height: number) => ({ width: width - 240, height: height - 60 });
  const firstZoom = (width: number, height: number) => fitView(canvasOf(width, height), SCENE)?.k;

  it('opens at zoom 1 in a 1280 x 790 window', () => {
    expect(firstZoom(1280, 790)).toBe(1);
    expect(firstZoom(1440, 820)).toBe(1);
  });

  it('opens with small names in a 1366 x 650 window: the height limits the fit', () => {
    const k = firstZoom(1366, 650) ?? 0;
    expect(k).toBeCloseTo(0.864, 3);
    expect(detailLevel(k)).toBe('full');
  });

  it('opens with codes once the window is 10 pixels shorter', () => {
    const k = firstZoom(1366, 640) ?? 0;
    expect(k).toBeCloseTo(0.848, 3);
    expect(detailLevel(k)).toBe('code');
  });

  it('opens with codes in a short and in a narrow window', () => {
    expect(detailLevel(firstZoom(1280, 620) ?? 0)).toBe('code');
    // Here the width limits the fit: 0.845, six pixels of scene width short of names.
    const narrow = firstZoom(1024, 700) ?? 0;
    expect(narrow).toBeCloseTo(0.845, 3);
    expect(detailLevel(narrow)).toBe('code');
  });
});

describe('wheelFactor', () => {
  it('zooms in for a negative delta and out for a positive one', () => {
    expect(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
  });

  it('gives the same zoom for one large delta and for the same distance in small steps', () => {
    const once = wheelFactor({ deltaY: -120, deltaMode: 0, ctrlKey: false });
    let steps = 1;
    for (let i = 0; i < 40; i++) steps *= wheelFactor({ deltaY: -3, deltaMode: 0, ctrlKey: false });
    expect(steps).toBeCloseTo(once, 10);
  });

  it('uses a larger gain for a pinch, which arrives with ctrlKey and small deltas', () => {
    const pinch = wheelFactor({ deltaY: -4, deltaMode: 0, ctrlKey: true });
    const scroll = wheelFactor({ deltaY: -4, deltaMode: 0, ctrlKey: false });
    expect(pinch).toBeGreaterThan(scroll);
  });

  it('counts a line as 16 pixels and caps one event at a factor of two', () => {
    expect(wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(
      wheelFactor({ deltaY: -48, deltaMode: 0, ctrlKey: false }),
      10,
    );
    expect(wheelFactor({ deltaY: -100000, deltaMode: 0, ctrlKey: false })).toBeCloseTo(2, 10);
    expect(wheelFactor({ deltaY: 100000, deltaMode: 0, ctrlKey: false })).toBeCloseTo(0.5, 10);
  });
});

describe('reveal', () => {
  const at = (x: number, y: number, width = 0, height = 0) => ({ x, y, width, height });

  it('returns the same view when the box is already inside', () => {
    expect(reveal(IDENTITY, at(500, 300, 100, 24), SIZE, 48)).toBe(IDENTITY);
  });

  it('pans just far enough to bring a box in from each side', () => {
    expect(reveal(IDENTITY, at(-100, 300), SIZE, 48)).toEqual({ x: 148, y: 0, k: 1 });
    expect(reveal(IDENTITY, at(500, 900), SIZE, 48)).toEqual({ x: 0, y: -348, k: 1 });
    // The far edge of the box counts, not only its corner.
    expect(reveal(IDENTITY, at(900, 300, 150, 24), SIZE, 48)).toEqual({ x: -98, y: 0, k: 1 });
  });

  it('counts the zoom', () => {
    const view = { x: 0, y: 0, k: 2 };
    expect(reveal(view, at(450, 100, 50, 10), SIZE, 48)).toEqual({ x: -48, y: 0, k: 2 });
  });

  it('shows the top left corner of a box that is larger than the viewport', () => {
    expect(reveal(IDENTITY, at(200, 100, 2000, 1000), SIZE, 48)).toEqual({ x: -152, y: -52, k: 1 });
  });
});

describe('keepInSight', () => {
  it('leaves a view alone while the scene is in sight', () => {
    const view = fitView(SIZE, BOX);
    if (!view) throw new Error('no fit');
    expect(keepInSight(view, SIZE, BOX)).toBe(view);
  });

  it('stops the scene from leaving the viewport', () => {
    const far = panBy(IDENTITY, 50000, -50000);
    const kept = keepInSight(far, SIZE, BOX);
    const left = BOX.x * kept.k + kept.x;
    const bottom = (BOX.y + BOX.height) * kept.k + kept.y;
    expect(left).toBe(SIZE.width - ZOOM.keepVisible);
    expect(bottom).toBe(ZOOM.keepVisible);
  });
});
