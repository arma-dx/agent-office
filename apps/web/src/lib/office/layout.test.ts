import { describe, expect, it } from 'vitest';
import { project } from './iso.ts';
import {
  assignCells,
  LAYOUT,
  layoutOffice,
  ringCells,
  roomGrid,
  type Cell,
  type LayoutUnit,
  type OfficeLayout,
  type Rect,
} from './layout.ts';

/** Units U1, U2, ... with the given numbers of agents. */
function unitsOf(counts: readonly number[]): LayoutUnit[] {
  return counts.map((count, index) => {
    const code = `U${index + 1}`;
    return { code, agents: Array.from({ length: count }, (_, i) => `${code}-${i + 1}`) };
  });
}

function unit(code: string, agents: number): LayoutUnit {
  return { code, agents: Array.from({ length: agents }, (_, i) => `${code}-${i + 1}`) };
}

// The pilot cards on 6 October 2026, in the order GET /api/office gives the units: shared units by
// code, then the company's own by code.
const ARMADX = [
  unit('HAF', 2),
  unit('KOR', 4),
  unit('SOS', 1),
  unit('TAS', 2),
  unit('A-KES', 1),
  unit('A-PRJ', 1),
  unit('A-TEK', 1),
];
const PILLIKA = [unit('HAF', 2), unit('KOR', 4), unit('SOS', 1), unit('TAS', 2), unit('P-IST', 1)];
const FOUNDER = [unit('KOR', 1)];
// Agents per unit in the design report (37 units, 173 agents, at most 9 in one unit).
const REPORT = [
  5, 3, 4, 5, 8, 9, 6, 5, 5, 9, 7, 4, 4, 4, 8, 6, 4, 4, 4, 5, 3, 3, 5, 4, 4, 4, 5, 4, 5, 4, 3, 3, 6,
  3, 2, 2, 4,
];

function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

/** Free tiles between two rectangles on the floor; 0 when they touch or overlap. */
function floorGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.d), a.y - (b.y + b.d), 0);
  return Math.max(dx, dy);
}

/**
 * True when something standing on `front` can cover part of `back` on the screen, so `back` has to
 * be painted first. A thing at a floor point rises straight up on the screen, over the floor points
 * that are smaller by the same amount in x and in y.
 */
function mustPaintBefore(back: Rect, front: Rect): boolean {
  const low = Math.max(0, front.x - (back.x + back.w), front.y - (back.y + back.d));
  const high = Math.min(front.x + front.w - back.x, front.y + front.d - back.y);
  return low < high;
}

function expectValidPaintOrder(layout: OfficeLayout) {
  const order = layout.paintOrder;
  expect([...order].sort((a, b) => a - b)).toEqual(layout.rooms.map((_, index) => index));
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const earlier = layout.rooms[order[i]!]!;
      const later = layout.rooms[order[j]!]!;
      expect(
        mustPaintBefore(later.rect, earlier.rect),
        `${later.unit} before ${earlier.unit}`,
      ).toBe(false);
    }
  }
}

function topVertex(layout: OfficeLayout, code: string): [number, number] {
  const room = layout.rooms.find((candidate) => candidate.unit === code);
  if (!room) throw new Error(`no room for ${code}`);
  const point = project(room.rect.x, room.rect.y);
  return [point.x, point.y];
}

describe('ringCells', () => {
  it('gives ring 1 in the fixed order: the four axis neighbours, then top and bottom, then right and left', () => {
    expect(ringCells(1).map(cellKey)).toEqual([
      '-1,0', // upper left on the screen
      '1,0', // lower right
      '0,-1', // upper right
      '0,1', // lower left
      '-1,-1', // top
      '1,1', // bottom
      '1,-1', // right
      '-1,1', // left
    ]);
  });

  it('follows every cell at an even place by the cell opposite to it, in rings 1 to 4', () => {
    for (const ring of [1, 2, 3, 4]) {
      const cells = ringCells(ring);
      for (let index = 0; index < cells.length; index += 2) {
        const cell = cells[index]!;
        expect(cellKey(cells[index + 1]!), `ring ${ring}, place ${index}`).toBe(
          cellKey({ col: -cell.col, row: -cell.row }),
        );
      }
    }
  });

  it('gives 8 x ring distinct cells, all on the ring', () => {
    for (const ring of [1, 2, 3, 4]) {
      const cells = ringCells(ring);
      expect(cells).toHaveLength(8 * ring);
      expect(new Set(cells.map(cellKey)).size).toBe(8 * ring);
      for (const cell of cells) {
        expect(Math.max(Math.abs(cell.col), Math.abs(cell.row))).toBe(ring);
      }
    }
  });
});

describe('assignCells', () => {
  it('fills ring 1 before ring 2 and never uses a cell twice', () => {
    for (let count = 0; count <= 60; count++) {
      const cells = assignCells(count);
      expect(cells).toHaveLength(count);
      expect(new Set(cells.map(cellKey)).size).toBe(count);
      const inRingOne = cells.filter((cell) => Math.abs(cell.col) <= 1 && Math.abs(cell.row) <= 1);
      expect(inRingOne).toHaveLength(Math.min(count, 8));
    }
  });

  it('gives a longer list the same first cells: a new unit never moves the ones before it', () => {
    const seven = assignCells(7);
    expect(assignCells(8).slice(0, 7)).toEqual(seven);
    expect(assignCells(36).slice(0, 7)).toEqual(seven);
  });
});

describe('roomGrid', () => {
  it('uses one row up to two agents and two rows after that', () => {
    const size = (count: number) => {
      const { cols, rows } = roomGrid(count);
      return `${cols}x${rows}`;
    };
    expect([0, 1, 2].map(size)).toEqual(['1x1', '1x1', '2x1']);
    expect([3, 4, 5, 6].map(size)).toEqual(['2x2', '2x2', '3x2', '3x2']);
    expect([7, 8, 9, 10].map(size)).toEqual(['4x2', '4x2', '5x2', '5x2']);
  });
});

describe('layoutOffice', () => {
  it('gives the same layout for the same list and does not touch its input', () => {
    const input = Object.freeze(ARMADX.map((item) => Object.freeze(item)));
    expect(layoutOffice(input, { centreUnit: 'HAF' })).toEqual(
      layoutOffice(ARMADX, { centreUnit: 'HAF' }),
    );
  });

  it('keeps units and agents in the order they were given', () => {
    const layout = layoutOffice(ARMADX, { centreUnit: 'HAF' });
    expect(layout.rooms.map((room) => room.unit)).toEqual(ARMADX.map((item) => item.code));
    expect(layout.rooms[0]?.desks.map((desk) => desk.agent)).toEqual(ARMADX[0]?.agents);
  });

  it('handles an empty list', () => {
    const layout = layoutOffice([]);
    expect(layout.rooms).toEqual([]);
    expect(layout.paintOrder).toEqual([]);
    expect(layout.walkways).toEqual([]);
    expect(layout.floorBounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('sizes a room from its number of agents: 5 tiles per desk cell and 1 tile of floor around', () => {
    const [one, two, four, nine] = layoutOffice(unitsOf([1, 2, 4, 9])).rooms;
    expect([one?.rect.w, one?.rect.d]).toEqual([7, 7]);
    expect([two?.rect.w, two?.rect.d]).toEqual([12, 7]);
    expect([four?.rect.w, four?.rect.d]).toEqual([12, 12]);
    expect([nine?.rect.w, nine?.rect.d]).toEqual([27, 12]);
  });

  it('puts the back row first and marks the row of every desk', () => {
    const room = layoutOffice(unitsOf([4])).rooms[0];
    expect(room?.desks.map((desk) => desk.row)).toEqual([0, 0, 1, 1]);
    const [first, second, third] = room?.desks ?? [];
    expect(second && first && second.x - first.x).toBe(LAYOUT.cell);
    expect(third && first && third.y - first.y).toBe(LAYOUT.cell);
    expect(third?.x).toBe(first?.x);
  });

  it('places the pilot offices where the design measured them', () => {
    const armadx = layoutOffice(ARMADX, { centreUnit: 'HAF' });
    expect(topVertex(armadx, 'HAF')).toEqual([-40, -76]);
    expect(topVertex(armadx, 'KOR')).toEqual([-256, -224]);
    expect(topVertex(armadx, 'TAS')).toEqual([176, -184]);
    expect(topVertex(armadx, 'SOS')).toEqual([216, 52]);
    expect(topVertex(armadx, 'A-KES')).toEqual([-216, 52]);
    expect(topVertex(armadx, 'A-PRJ')).toEqual([-40, -292]);
    expect(topVertex(armadx, 'A-TEK')).toEqual([0, 160]);
    expect([armadx.floorBounds.width, armadx.floorBounds.height]).toEqual([816, 564]);

    const pillika = layoutOffice(PILLIKA, { centreUnit: 'HAF' });
    expect(topVertex(pillika, 'P-IST')).toEqual([-216, 52]);
    expect([pillika.floorBounds.width, pillika.floorBounds.height]).toEqual([816, 388]);

    const founder = layoutOffice(FOUNDER, { centreUnit: 'HAF' });
    expect([founder.floorBounds.width, founder.floorBounds.height]).toEqual([224, 112]);
  });

  it('puts a shared unit in the same cell and at the same place in both companies', () => {
    const armadx = layoutOffice(ARMADX, { centreUnit: 'HAF' });
    const pillika = layoutOffice(PILLIKA, { centreUnit: 'HAF' });
    for (const code of ['KOR', 'HAF', 'TAS', 'SOS']) {
      const a = armadx.rooms.find((room) => room.unit === code);
      const p = pillika.rooms.find((room) => room.unit === code);
      expect(a?.cell, code).toEqual(p?.cell);
      expect(a?.rect, code).toEqual(p?.rect);
    }
  });

  it('keeps every vertex of every floor, desk and walkway on a whole pixel', () => {
    for (const units of [ARMADX, PILLIKA, FOUNDER, unitsOf(REPORT)]) {
      const layout = layoutOffice(units, { centreUnit: 'HAF' });
      const points: [number, number][] = [];
      for (const { rect, desks } of layout.rooms) {
        points.push([rect.x, rect.y], [rect.x + rect.w, rect.y + rect.d]);
        for (const desk of desks) points.push([desk.x, desk.y]);
      }
      for (const rect of layout.walkways) {
        points.push([rect.x, rect.y], [rect.x + rect.w, rect.y + rect.d]);
      }
      for (const [x, y] of points) {
        const point = project(x, y);
        expect(Number.isInteger(point.x), `x of ${x},${y}`).toBe(true);
        expect(Number.isInteger(point.y), `y of ${x},${y}`).toBe(true);
      }
    }
  });

  it.each([
    ['one unit', unitsOf([3])],
    ['Arma DX pilot', ARMADX],
    ['Pillika pilot', PILLIKA],
    ['a full first ring', unitsOf([1, 1, 1, 1, 1, 1, 1, 1, 1])],
    ['ten units', unitsOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])],
    ['all 37 units of the report', unitsOf(REPORT)],
    ['a unit with 12 agents and an empty one', unitsOf([12, 9, 1, 0, 5])],
    ['60 units', unitsOf(Array.from({ length: 60 }, (_, i) => i % 10))],
  ])(
    'keeps rooms apart by the gap, desks inside their room and a valid paint order: %s',
    (_name, units) => {
      const layout = layoutOffice(units, { centreUnit: units[1]?.code ?? 'NONE' });
      const { rooms } = layout;
      for (let i = 0; i < rooms.length; i++) {
        const a = rooms[i]!;
        for (let j = i + 1; j < rooms.length; j++) {
          const b = rooms[j]!;
          expect(overlaps(a.rect, b.rect), `${a.unit} and ${b.unit}`).toBe(false);
          // Rooms in different rows and columns of the table are apart on both axes; only rooms in
          // one row or one column face each other, and they keep the full gap.
          if (a.cell.col === b.cell.col || a.cell.row === b.cell.row) {
            expect(floorGap(a.rect, b.rect), `${a.unit} and ${b.unit}`).toBeGreaterThanOrEqual(
              LAYOUT.gap,
            );
          }
        }
        const cells = new Set<string>();
        for (const desk of a.desks) {
          const half = LAYOUT.cell / 2;
          expect(desk.x - half).toBeGreaterThanOrEqual(a.rect.x + LAYOUT.pad);
          expect(desk.y - half).toBeGreaterThanOrEqual(a.rect.y + LAYOUT.pad);
          expect(desk.x + half).toBeLessThanOrEqual(a.rect.x + a.rect.w - LAYOUT.pad);
          expect(desk.y + half).toBeLessThanOrEqual(a.rect.y + a.rect.d - LAYOUT.pad);
          cells.add(`${desk.x},${desk.y}`);
        }
        expect(cells.size).toBe(a.desks.length);
      }
      expectValidPaintOrder(layout);
    },
  );

  it('contains every floor in the floor bounds', () => {
    for (const units of [ARMADX, PILLIKA, unitsOf(REPORT)]) {
      const { rooms, floorBounds } = layoutOffice(units, { centreUnit: 'HAF' });
      for (const { rect } of rooms) {
        for (const [x, y] of [
          [rect.x, rect.y],
          [rect.x + rect.w, rect.y],
          [rect.x + rect.w, rect.y + rect.d],
          [rect.x, rect.y + rect.d],
        ] as const) {
          const point = project(x, y);
          expect(point.x).toBeGreaterThanOrEqual(floorBounds.x);
          expect(point.x).toBeLessThanOrEqual(floorBounds.x + floorBounds.width);
          expect(point.y).toBeGreaterThanOrEqual(floorBounds.y);
          expect(point.y).toBeLessThanOrEqual(floorBounds.y + floorBounds.height);
        }
      }
    }
  });

  it('changes no cell when a unit gains an agent, and moves nothing while the room keeps its size', () => {
    const before = layoutOffice(unitsOf([3, 2, 2, 1, 1, 1, 1]), { centreUnit: 'U2' });
    const same = layoutOffice(unitsOf([4, 2, 2, 1, 1, 1, 1]), { centreUnit: 'U2' });
    // Three and four agents need the same 2 x 2 room: only the new desk is added.
    expect(same.rooms.slice(1)).toEqual(before.rooms.slice(1));
    expect(same.rooms[0]?.rect).toEqual(before.rooms[0]?.rect);
    expect(same.rooms[0]?.desks.slice(0, 3)).toEqual(before.rooms[0]?.desks);
    expect(same.floorBounds).toEqual(before.floorBounds);

    // A fifth agent widens the room and with it the column of the table.
    const wider = layoutOffice(unitsOf([5, 2, 2, 1, 1, 1, 1]), { centreUnit: 'U2' });
    expect(wider.rooms.map((room) => room.cell)).toEqual(before.rooms.map((room) => room.cell));
    expect(wider.paintOrder).toEqual(before.paintOrder);
    expect(wider.rooms[0]?.rect.w).toBe(17);
    // Rooms in other columns keep their place across the table's middle; the centre never moves.
    expect(wider.rooms[1]?.rect).toEqual(before.rooms[1]?.rect);
  });

  it('keeps the units before it where they are when a unit is added at the end of the list', () => {
    const six = layoutOffice(unitsOf([4, 2, 2, 1, 1, 1]), { centreUnit: 'U2' });
    const seven = layoutOffice(unitsOf([4, 2, 2, 1, 1, 1, 1]), { centreUnit: 'U2' });
    expect(seven.rooms.slice(0, 6).map((room) => room.cell)).toEqual(
      six.rooms.map((room) => room.cell),
    );
  });

  it('puts the named unit in the centre and the others around it in order', () => {
    const units = unitsOf([2, 2, 2, 2]);
    const layout = layoutOffice(units, { centreUnit: 'U2' });
    expect(layout.rooms[1]?.cell).toEqual({ col: 0, row: 0 });
    const others = layoutOffice([units[0]!, units[2]!, units[3]!]);
    expect([0, 2, 3].map((index) => layout.rooms[index]?.cell)).toEqual(
      others.rooms.map((room) => room.cell),
    );
    // The centre room is centred on the scene origin.
    const centre = layout.rooms[1]?.rect;
    expect(centre && [centre.x + centre.w / 2, centre.y + centre.d / 2]).toEqual([0, 0]);
    expectValidPaintOrder(layout);
  });

  it('leaves the centre free when the named unit is not in the list', () => {
    const layout = layoutOffice(unitsOf([1, 1]), { centreUnit: 'NONE' });
    expect(layout).toEqual(layoutOffice(unitsOf([1, 1])));
    expect(layout.rooms.some((room) => room.cell.col === 0 && room.cell.row === 0)).toBe(false);
    expect(layout.walkways).toEqual([]);
  });

  it('joins every room to its neighbour toward the centre along one floor axis', () => {
    const armadx = layoutOffice(ARMADX, { centreUnit: 'HAF' });
    const pillika = layoutOffice(PILLIKA, { centreUnit: 'HAF' });
    expect(armadx.walkways).toHaveLength(6);
    expect(pillika.walkways).toHaveLength(4);
    for (const layout of [armadx, pillika]) {
      for (const walkway of layout.walkways) {
        // One side is the walkway's width, the other spans the gap between the two rooms.
        expect(Math.min(walkway.w, walkway.d)).toBe(LAYOUT.walkway);
        expect(Math.max(walkway.w, walkway.d)).toBeGreaterThanOrEqual(LAYOUT.gap);
        for (const room of layout.rooms) {
          expect(overlaps(walkway, room.rect), room.unit).toBe(false);
        }
        const touching = layout.rooms.filter((room) => floorGap(walkway, room.rect) === 0);
        expect(touching).toHaveLength(2);
      }
    }
  });
});
