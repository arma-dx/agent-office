/**
 * Layout of the office view: which unit stands in which cell of the table, how large its room is,
 * where each agent's desk goes and which rooms a walkway joins. A pure function of the unit list:
 * no viewport size, no clock, no randomness and no text measurement, so the same list always gives
 * the same scene.
 */
import { byDepth, project } from './iso.ts';

/** What the layout needs to know about a unit: its code and its agents, both already in display order. */
export interface LayoutUnit {
  readonly code: string;
  readonly agents: readonly string[];
}

export interface LayoutOptions {
  /** Code of the unit that takes the centre cell. Without it, or when it is not in the list, the centre stays free. */
  readonly centreUnit?: string;
}

/** Sizes in tiles (one tile is one step of the world grid). */
export const LAYOUT = {
  /** Tiles along one side of a desk cell. */
  cell: 5,
  /** Tiles of floor around the desks of a room. */
  pad: 1,
  /** Tiles of free floor between neighbouring cells of the table. */
  gap: 4,
  /** A room never has more rows of desks than this; it grows along x. */
  maxRows: 2,
  /** Width of a walkway in tiles. */
  walkway: 2,
} as const;

/** A cell of the table; the centre cell is 0, 0. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** A rectangle on the floor of the world grid. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

export interface DeskPlacement {
  readonly agent: string;
  /** Centre of the desk cell on the world grid; the desk sprite stands on this point. */
  readonly x: number;
  readonly y: number;
  /** 0 is the back row (far from the viewer). */
  readonly row: number;
}

export interface RoomPlacement {
  readonly unit: string;
  readonly cell: Cell;
  readonly rect: Rect;
  readonly desks: readonly DeskPlacement[];
}

/** A box in scene pixels. */
export interface SceneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OfficeLayout {
  /** In input order: the reading order and the keyboard order. */
  readonly rooms: readonly RoomPlacement[];
  /** Indexes into rooms, far to near: the paint order. */
  readonly paintOrder: readonly number[];
  /** Flat strips of floor that join neighbouring rooms. */
  readonly walkways: readonly Rect[];
  /** The box around every floor, without labels and cards (see overlay.ts for those). */
  readonly floorBounds: SceneBounds;
}

const CENTRE: Cell = { col: 0, row: 0 };

/**
 * Clockwise angle on the screen, 0 at the upper left, for the order of cells inside one ring.
 * The upper left of the screen is the direction of falling col, the upper right that of falling row.
 */
function clockwiseFromUpperLeft(cell: Cell): number {
  const turn = Math.atan2(-cell.row, -cell.col);
  return turn < 0 ? turn + 2 * Math.PI : turn;
}

/**
 * The cells of one ring in the order they are given out: the cells nearest to the two floor axes
 * first, then the ones nearest to the vertical middle of the screen; inside each of these groups a
 * cell is followed by the cell opposite to it, and the pairs go clockwise from the upper left.
 * For ring 1 this is: upper left, lower right, upper right, lower left, top, bottom, right, left.
 * Opposite sides fill first, so a small office stays balanced around the centre.
 */
export function ringCells(ring: number): Cell[] {
  const cells: Cell[] = [];
  for (let col = -ring; col <= ring; col++) {
    for (let row = -ring; row <= ring; row++) {
      if (Math.max(Math.abs(col), Math.abs(row)) === ring) cells.push({ col, row });
    }
  }
  const steps = (cell: Cell) => Math.abs(cell.col) + Math.abs(cell.row);
  const offCentre = (cell: Cell) => Math.abs(cell.col - cell.row);
  // The half of the ring that is passed first when going clockwise from the upper left.
  const firstHalf = (cell: Cell) => (cell.row < 0 || (cell.row === 0 && cell.col < 0) ? 0 : 1);
  // A cell and the cell opposite to it share this angle; no floating point remainder is taken.
  const pairTurn = (cell: Cell) =>
    clockwiseFromUpperLeft(firstHalf(cell) === 0 ? cell : { col: -cell.col, row: -cell.row });
  return cells.sort(
    (a, b) =>
      steps(a) - steps(b) ||
      offCentre(a) - offCentre(b) ||
      pairTurn(a) - pairTurn(b) ||
      firstHalf(a) - firstHalf(b),
  );
}

/** The first `count` cells around the centre. The cell of a unit depends only on its place in the list. */
export function assignCells(count: number): Cell[] {
  const cells: Cell[] = [];
  for (let ring = 1; cells.length < count; ring++) cells.push(...ringCells(ring));
  return cells.slice(0, count);
}

/** Desk grid of a room: one row up to two agents, then two rows; an empty unit gets a one-desk room. */
export function roomGrid(agentCount: number): { cols: number; rows: number } {
  const rows = agentCount <= 2 ? 1 : LAYOUT.maxRows;
  return { cols: Math.max(1, Math.ceil(agentCount / rows)), rows };
}

/** Start and end of every column (or row) of the table along its axis; index 0 is centred on 0. */
function tracks(sizes: ReadonlyMap<number, number>): Map<number, { from: number; to: number }> {
  const size = (index: number) => sizes.get(index) ?? 0;
  const indexes = [...sizes.keys(), 0];
  const result = new Map<number, { from: number; to: number }>();
  let edge = size(0) / 2;
  result.set(0, { from: -edge, to: edge });
  for (let index = 1; index <= Math.max(...indexes); index++) {
    const from = edge + LAYOUT.gap;
    edge = from + size(index);
    result.set(index, { from, to: edge });
  }
  edge = -size(0) / 2;
  for (let index = -1; index >= Math.min(...indexes); index--) {
    const to = edge - LAYOUT.gap;
    edge = to - size(index);
    result.set(index, { from: edge, to });
  }
  return result;
}

/** The cell one step nearer to the centre: along the row axis first, so a corner room joins its own column. */
function towardCentre(cell: Cell): Cell {
  if (cell.row !== 0) return { col: cell.col, row: cell.row - Math.sign(cell.row) };
  return { col: cell.col - Math.sign(cell.col), row: 0 };
}

/** The strip of floor between two rooms in neighbouring cells, centred on the edges that face each other. */
function walkwayBetween(a: Rect, b: Rect, alongX: boolean): Rect {
  const half = LAYOUT.walkway / 2;
  if (alongX) {
    const [near, far] = a.x < b.x ? [a, b] : [b, a];
    const middle = (Math.max(a.y, b.y) + Math.min(a.y + a.d, b.y + b.d)) / 2;
    return { x: near.x + near.w, y: middle - half, w: far.x - near.x - near.w, d: LAYOUT.walkway };
  }
  const [near, far] = a.y < b.y ? [a, b] : [b, a];
  const middle = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
  return { x: middle - half, y: near.y + near.d, w: LAYOUT.walkway, d: far.y - near.y - near.d };
}

function key(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

/** Places every unit in a cell of the table and every agent on a desk cell of its room. */
export function layoutOffice(
  units: readonly LayoutUnit[],
  options: LayoutOptions = {},
): OfficeLayout {
  const centreIndex =
    options.centreUnit === undefined
      ? -1
      : units.findIndex((unit) => unit.code === options.centreUnit);
  const around = assignCells(centreIndex === -1 ? units.length : units.length - 1);

  const sized = units.map((unit, index) => {
    const ringIndex = centreIndex !== -1 && index > centreIndex ? index - 1 : index;
    const cell = index === centreIndex ? CENTRE : around[ringIndex];
    if (!cell) throw new Error('No cell for unit');
    const { cols, rows } = roomGrid(unit.agents.length);
    return {
      unit,
      cell,
      cols,
      w: LAYOUT.cell * cols + 2 * LAYOUT.pad,
      d: LAYOUT.cell * rows + 2 * LAYOUT.pad,
    };
  });

  // A column is as wide as its widest room, a row as deep as its deepest room.
  const widths = new Map<number, number>();
  const depths = new Map<number, number>();
  for (const { cell, w, d } of sized) {
    widths.set(cell.col, Math.max(widths.get(cell.col) ?? 0, w));
    depths.set(cell.row, Math.max(depths.get(cell.row) ?? 0, d));
  }
  const columns = tracks(widths);
  const rowTracks = tracks(depths);

  const rooms = sized.map(({ unit, cell, cols, w, d }): RoomPlacement => {
    const column = columns.get(cell.col);
    const row = rowTracks.get(cell.row);
    if (!column || !row) throw new Error('No track for cell');
    // Each room is centred in its cell.
    const rect: Rect = {
      x: (column.from + column.to) / 2 - w / 2,
      y: (row.from + row.to) / 2 - d / 2,
      w,
      d,
    };
    const desks = unit.agents.map((agent, i): DeskPlacement => {
      const deskRow = Math.floor(i / cols);
      return {
        agent,
        x: rect.x + LAYOUT.pad + LAYOUT.cell * ((i % cols) + 0.5),
        y: rect.y + LAYOUT.pad + LAYOUT.cell * (deskRow + 0.5),
        row: deskRow,
      };
    });
    return { unit: unit.code, cell, rect, desks };
  });

  // The tracks of the table do not overlap, so the order of the cells is the order of the rooms.
  const paintOrder = rooms
    .map((room, index) => ({ index, x: room.cell.col, y: room.cell.row }))
    .sort(byDepth)
    .map((entry) => entry.index);

  const byCell = new Map(rooms.map((room) => [key(room.cell), room]));
  const walkways: Rect[] = [];
  for (const room of rooms) {
    if (room.cell.col === 0 && room.cell.row === 0) continue;
    const inner = towardCentre(room.cell);
    const neighbour = byCell.get(key(inner));
    if (neighbour) {
      walkways.push(walkwayBetween(room.rect, neighbour.rect, inner.row === room.cell.row));
    }
  }

  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (const [index, { rect }] of rooms.entries()) {
    const corners = {
      top: project(rect.x, rect.y).y,
      right: project(rect.x + rect.w, rect.y).x,
      bottom: project(rect.x + rect.w, rect.y + rect.d).y,
      left: project(rect.x, rect.y + rect.d).x,
    };
    left = index === 0 ? corners.left : Math.min(left, corners.left);
    right = index === 0 ? corners.right : Math.max(right, corners.right);
    top = index === 0 ? corners.top : Math.min(top, corners.top);
    bottom = index === 0 ? corners.bottom : Math.max(bottom, corners.bottom);
  }

  return {
    rooms,
    paintOrder,
    walkways,
    floorBounds: { x: left, y: top, width: right - left, height: bottom - top },
  };
}
