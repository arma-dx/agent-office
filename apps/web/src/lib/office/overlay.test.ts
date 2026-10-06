import { describe, expect, it } from 'vitest';
import { ARMADX_OFFICE, FOUNDER_OFFICE, PILLIKA_OFFICE } from '@/test/office-fixtures';
import { layoutOffice } from './layout.ts';
import { agentId, CENTRE_UNIT, shortName, unitId, type OfficeUnit } from './model.ts';
import {
  clashes,
  clearance,
  detailLevel,
  extentOf,
  OVERLAY,
  overlayAnchors,
  overlayBox,
  overlayBoxes,
  overlayScale,
  sceneBounds,
  spriteBoxes,
} from './overlay.ts';
import type { Size } from './view.ts';

function layoutOf(units: readonly OfficeUnit[]) {
  return layoutOffice(
    units.map((unit) => ({ code: unit.code, agents: unit.agents.map((agent) => agent.code) })),
    { centreUnit: CENTRE_UNIT },
  );
}

/**
 * Stand-in for the browser's measurement: 6.9 pixels per character at 13 pixel text plus 20 pixels
 * of padding and border, at most 224; a card is 216 wide and needs a second line for a unit name of
 * more than 26 characters.
 */
function estimatedSizes(units: readonly OfficeUnit[]): Map<string, Size> {
  const sizes = new Map<string, Size>();
  for (const unit of units) {
    sizes.set(unitId(unit.code), { width: 216, height: unit.name.length > 26 ? 65 : 48 });
    for (const agent of unit.agents) {
      const text = `${agent.code} ${shortName(agent.name)}`;
      sizes.set(agentId(agent.code), {
        width: Math.min(224, Math.round(text.length * 6.9 + 20)),
        height: 24,
      });
    }
  }
  return sizes;
}

describe('detailLevel and overlayScale', () => {
  it('shows full labels from 0.85, codes from 0.6 and only unit cards below', () => {
    expect([2, 1, 0.85].map(detailLevel)).toEqual(['full', 'full', 'full']);
    expect([0.84, 0.6].map(detailLevel)).toEqual(['code', 'code']);
    expect([0.59, 0.5].map(detailLevel)).toEqual(['units', 'units']);
  });

  it('shrinks labels with the scene down to 0.85 and never enlarges them', () => {
    expect(overlayScale(2)).toBe(1);
    expect(overlayScale(1)).toBe(1);
    expect(overlayScale(0.9)).toBe(0.9);
    expect(overlayScale(0.5)).toBe(OVERLAY.fullFrom);
    // 13 pixel text never goes below 11 pixels.
    expect(13 * overlayScale(0.5)).toBeGreaterThanOrEqual(11);
  });
});

describe('overlayAnchors', () => {
  it('lists a unit and then its agents, in the order of the data', () => {
    const anchors = overlayAnchors(layoutOf(ARMADX_OFFICE));
    expect(anchors.slice(0, 6).map((anchor) => anchor.id)).toEqual([
      'unit:HAF',
      'agent:HAF-1',
      'agent:HAF-2',
      'unit:KOR',
      'agent:KOR-1',
      'agent:KOR-2',
    ]);
    expect(anchors).toHaveLength(7 + 12);
  });

  it('hangs back row labels above their desk and front row labels below it', () => {
    const anchors = overlayAnchors(layoutOf(ARMADX_OFFICE));
    const placement = (id: string) => anchors.find((anchor) => anchor.id === id)?.placement;
    expect(placement('unit:KOR')).toBe('card');
    expect(['agent:KOR-1', 'agent:KOR-2'].map(placement)).toEqual(['above', 'above']);
    expect(['agent:KOR-3', 'agent:KOR-5'].map(placement)).toEqual(['below', 'below']);
    // A room with one row has only back row labels.
    expect(['agent:HAF-1', 'agent:HAF-2'].map(placement)).toEqual(['above', 'above']);
  });
});

describe('overlayBox', () => {
  const size = { width: 100, height: 24 };

  it('centres a card above its point, lifted by cardLift', () => {
    expect(overlayBox({ id: 'c', placement: 'card', x: 10, y: 50 }, size)).toEqual({
      id: 'c',
      x: -40,
      y: 50 - OVERLAY.cardLift - 24,
      width: 100,
      height: 24,
    });
  });

  it('grows a back row label up and to the right, a front row label down and to the left', () => {
    const above = overlayBox({ id: 'a', placement: 'above', x: 10, y: 50 }, size);
    expect([above.x, above.y]).toEqual([10, 50 - OVERLAY.labelGap - 24]);
    const below = overlayBox({ id: 'b', placement: 'below', x: 10, y: 50 }, size);
    expect([below.x, below.y]).toEqual([-90, 50 + OVERLAY.labelGap]);
  });
});

describe('extentOf', () => {
  const layout = layoutOf(ARMADX_OFFICE);
  const boxes = overlayBoxes(overlayAnchors(layout), estimatedSizes(ARMADX_OFFICE));

  it('covers the label and the desk of an agent', () => {
    const extent = extentOf(layout, boxes, 'agent:KOR-1');
    const label = boxes.find((box) => box.id === 'agent:KOR-1');
    const sprite = spriteBoxes(layout).find((box) => box.id === 'sprite:KOR-1');
    if (!extent || !label || !sprite) throw new Error('missing');
    // A back row label sits above the desk and starts at its left edge.
    expect(extent.x).toBe(sprite.x);
    expect(extent.y).toBe(label.y);
    expect(extent.x + extent.width).toBe(Math.max(label.x + label.width, sprite.x + sprite.width));
    expect(extent.y + extent.height).toBe(sprite.y + sprite.height);
  });

  it('covers the card, the floor and the slab of a unit', () => {
    const extent = extentOf(layout, boxes, 'unit:KOR');
    const card = boxes.find((box) => box.id === 'unit:KOR');
    if (!extent || !card) throw new Error('missing');
    // The room of four desks is a 384 x 192 diamond on a 10 pixel slab.
    expect(extent.width).toBe(384);
    expect(extent.y).toBe(card.y);
    expect(extent.height).toBe(card.height + OVERLAY.cardLift + 192 + OVERLAY.slab);
  });

  it('knows nothing of an id that is not in the scene', () => {
    expect(extentOf(layout, boxes, 'agent:NONE')).toBeNull();
  });
});

describe('clearance and clashes', () => {
  it('measures the free pixels between two boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(clearance(a, { x: 14, y: 0, width: 5, height: 5 })).toBe(4);
    expect(clearance(a, { x: 0, y: 13, width: 5, height: 5 })).toBe(3);
    expect(clearance(a, { x: 20, y: 30, width: 5, height: 5 })).toBe(20);
    expect(clearance(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(0);
  });

  it('reports pairs closer than the gap, but never two sprites', () => {
    const boxes = [
      { id: 'sprite:A', x: 0, y: 0, width: 10, height: 10 },
      { id: 'sprite:B', x: 5, y: 0, width: 10, height: 10 },
      { id: 'agent:A', x: 17, y: 0, width: 10, height: 10 },
    ];
    expect(clashes(boxes, 4)).toEqual([['sprite:B', 'agent:A']]);
    expect(clashes(boxes, 2)).toEqual([]);
  });
});

describe('the pilot offices with estimated label sizes', () => {
  it.each([
    ['Arma DX', ARMADX_OFFICE, 916, 646],
    ['Pillika', PILLIKA_OFFICE, 916, 470],
  ])(
    '%s: no label, card or desk is closer than 4 pixels to another',
    (_name, units, width, height) => {
      const layout = layoutOf(units);
      const boxes = overlayBoxes(overlayAnchors(layout), estimatedSizes(units));
      expect(clashes([...boxes, ...spriteBoxes(layout)], 4)).toEqual([]);
      const bounds = sceneBounds(layout, boxes);
      // Label widths are rounded estimates; one pixel of difference is rounding.
      expect(Math.abs(bounds.width - width)).toBeLessThanOrEqual(1);
      expect(bounds.height).toBe(height);
    },
  );

  it('Kurucu alanı: one room fits with its card and label', () => {
    const layout = layoutOf(FOUNDER_OFFICE);
    const boxes = overlayBoxes(overlayAnchors(layout), estimatedSizes(FOUNDER_OFFICE));
    expect(clashes([...boxes, ...spriteBoxes(layout)], 4)).toEqual([]);
    const bounds = sceneBounds(layout, boxes);
    expect(bounds.width).toBeLessThanOrEqual(280);
    expect(bounds.height).toBe(194);
  });

  it('takes the largest size for an element that was not measured yet', () => {
    const layout = layoutOf(ARMADX_OFFICE);
    const anchors = overlayAnchors(layout);
    const measured = sceneBounds(layout, overlayBoxes(anchors, estimatedSizes(ARMADX_OFFICE)));
    const unmeasured = sceneBounds(layout, overlayBoxes(anchors, new Map()));
    expect(unmeasured.width).toBeGreaterThanOrEqual(measured.width);
    expect(unmeasured.height).toBeGreaterThanOrEqual(measured.height);
  });

  it('counts the slab under the lowest floor in the scene bounds', () => {
    const layout = layoutOf(ARMADX_OFFICE);
    const bounds = sceneBounds(layout, []);
    expect(bounds.height).toBe(layout.floorBounds.height + OVERLAY.slab);
    expect(bounds.width).toBe(layout.floorBounds.width);
  });
});
