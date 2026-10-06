import { describe, expect, it } from 'vitest';
import { boxFaces, byDepth, ISO, project, toPoints, unproject } from './iso.ts';

describe('project', () => {
  it('puts the world origin at the scene origin', () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('moves x to the lower right, y to the lower left and z straight up', () => {
    expect(project(1, 0)).toEqual({ x: ISO.halfWidth, y: ISO.halfHeight });
    expect(project(0, 1)).toEqual({ x: -ISO.halfWidth, y: ISO.halfHeight });
    expect(project(0, 0, 1)).toEqual({ x: 0, y: -ISO.rise });
  });

  it('is undone by unproject on the floor', () => {
    for (const [x, y] of [
      [0, 0],
      [3, -2],
      [-7.5, 4.25],
    ] as const) {
      const back = unproject(project(x, y));
      expect(back.x).toBeCloseTo(x, 10);
      expect(back.y).toBeCloseTo(y, 10);
    }
  });
});

describe('toPoints', () => {
  it('keeps half-tile steps on whole pixels', () => {
    for (const [x, y] of [
      [0.5, 0],
      [-3.5, 6],
      [8.5, -2.5],
    ] as const) {
      const point = project(x, y);
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
  });

  it('rounds to two decimals and never writes minus zero', () => {
    expect(toPoints([{ x: 1 / 3, y: -0 }])).toBe('0.33,0');
  });
});

describe('boxFaces', () => {
  it('gives the top as a diamond and the two near sides down to the foot of the box', () => {
    const faces = boxFaces({ x: 0, y: 0, z: 0, w: 2, d: 2, h: 1 });
    expect(faces.top).toBe('0,-16 32,0 0,16 -32,0');
    expect(faces.right).toBe('32,0 0,16 0,32 32,16');
    expect(faces.left).toBe('-32,0 0,16 0,32 -32,16');
    expect(faces.outline).toBe('0,-16 32,0 32,16 0,32 -32,16 -32,0');
  });

  it('collapses the sides of a flat box onto its top edge', () => {
    const faces = boxFaces({ x: 0, y: 0, z: 0, w: 2, d: 2, h: 0 });
    expect(faces.right).toBe('32,16 0,32 0,32 32,16');
  });
});

describe('byDepth', () => {
  it('orders far to near and breaks ties by x', () => {
    const cells = [
      { id: 'near', x: 1, y: 1 },
      { id: 'right', x: 1, y: 0 },
      { id: 'far', x: 0, y: 0 },
      { id: 'left', x: 0, y: 1 },
    ];
    expect([...cells].sort(byDepth).map((cell) => cell.id)).toEqual([
      'far',
      'left',
      'right',
      'near',
    ]);
  });
});
