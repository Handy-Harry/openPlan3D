import { expect, test } from 'vitest';
import { parseRoomDimension, roomDrawingEnd, roomDrawingPlacement, roomBoundary, roomInteriorCorner, snapRoomCorner, oppositeRoomCorner, alignedRoomCorner, missingRoomWalls } from '../src/lib/utils/roomDrawing';
import { detectRooms } from '../src/lib/utils/roomDetection';
import { roomPresets } from '../src/lib/utils/roomPresets';
import { wallEdgeInsets } from '../src/lib/utils/canvasRenderer';
import type { Wall } from '../src/lib/models/types';

test('parses centimeter dimensions and rejects incomplete or invalid input', () => {
  for (const text of ['525.5', '525,5']) {
    expect(parseRoomDimension(text)).toBe(525.5);
  }
  for (const text of ['', '4;', '0', '-4', 'Infinity', '4junk', '4;3', '0.1']) {
    expect(parseRoomDimension(text)).toBeNull();
  }
});

test('snapped adjacent rooms reuse all or part of an existing wall without changing it', () => {
  const original = roomBoundary({ x: 0, y: 0 }, { x: 400, y: 300 }, 15)
    .map((w, i) => ({ ...w, id: `original-${i}`, thickness: 15, height: 280, color: '#444' } as Wall));
  const saved = structuredClone(original);
  for (const length of [150, 300, 450]) {
    const anchor = snapRoomCorner({ x: 411, y: -5 }, original, 18, 15)!;
    expect(anchor.point).toEqual({ x: 407.5, y: -7.5 });
    const start = roomInteriorCorner(anchor, { x: 800, y: 300 });
    expect(start).toEqual({ x: 415, y: 0 });
    const end = roomDrawingEnd(start, { x: 800, y: 300 }, '400', String(length));
    const boundary = roomBoundary(start, end, 15, anchor);
    const missing = missingRoomWalls(boundary, original);
    expect(missing).toHaveLength(length <= 300 ? 3 : 4);
    const combined = [...original, ...missing.map((w, i) => ({ ...w, id: `new-${i}`, thickness: 15, height: 280, color: '#444' } as Wall))];
    expect(detectRooms(combined)).toHaveLength(2);
    expect(missingRoomWalls(boundary, combined)).toHaveLength(0);
    expect(original).toEqual(saved);
  }
});

test('shared thick wall preserves clear width and off-grid anchor', () => {
  const wall = { id: 'shared', start: { x: 17.3, y: 22.7 }, end: { x: 17.3, y: 522.7 }, thickness: 30 } as Wall;
  const anchor = snapRoomCorner({ x: 20, y: 25 }, [wall], 18, 15)!;
  const start = roomInteriorCorner(anchor, { x: 500, y: 500 });
  const end = roomDrawingEnd(start, { x: 500, y: 500 }, '400', '300');
  const boundary = roomBoundary(start, end, 15, anchor);
  expect(boundary[0].start).toEqual(wall.start);
  expect(boundary[0].end.x - 15 / 2 - (wall.start.x + 30 / 2)).toBeCloseTo(400);
  expect(snapRoomCorner({ x: 200, y: 200 }, [wall], 18, 15)).toBeNull();
});

test('135 by 80 inner room displays exact clear spans at two T-junctions', () => {
  const outer = roomBoundary({ x: 0, y: 0 }, { x: 545, y: 565 }, 15)
    .map((w, i) => ({ ...w, id: `outer-${i}`, thickness: 15, height: 280, color: '#444' } as Wall));
  const before = structuredClone(outer);
  const anchor = snapRoomCorner({ x: 552.5, y: 572.5 }, outer, 18, 15)!;
  const start = roomInteriorCorner(anchor, { x: 400, y: 400 });
  const end = roomDrawingEnd(start, { x: 400, y: 400 }, '135', '80');
  const added = missingRoomWalls(roomBoundary(start, end, 15, anchor), outer)
    .map((w, i) => ({ ...w, id: `partition-${i}`, thickness: 15, height: 280, color: '#444' } as Wall));
  expect(added).toHaveLength(2);
  const all = [...outer, ...added];
  const clearSpans = added.map(w => {
    const inset = wallEdgeInsets(w, all);
    expect(inset).toEqual({ start: 7.5, end: 7.5 });
    return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) - inset.start - inset.end;
  }).sort((a, b) => a - b);
  expect(clearSpans).toEqual([80, 135]);
  expect(detectRooms(all)).toHaveLength(2);
  expect(outer).toEqual(before);
});

test('T-junction insets ignore parallel, distant and extended walls', () => {
  const wall = { id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 15 } as Wall;
  const neighbor = (id: string, start: {x: number; y: number}, end: {x: number; y: number}) => ({ id, start, end, thickness: 30 } as Wall);
  expect(wallEdgeInsets(wall, [wall,
    neighbor('parallel', { x: -50, y: 0 }, { x: 200, y: 0 }),
    neighbor('distant', { x: 110, y: -100 }, { x: 110, y: 100 }),
    neighbor('extension', { x: 100, y: 20 }, { x: 100, y: 100 }),
  ])).toEqual({ start: 0, end: 0 });
  expect(wallEdgeInsets(wall, [wall,
    neighbor('shared', { x: 100, y: -100 }, { x: 100, y: 100 }),
  ])).toEqual({ start: 0, end: 15 });
});

test('opposite corner snaps to an off-grid wall corner and preserves clear dimensions', () => {
  const walls = roomBoundary({ x: 0, y: 0 }, { x: 200, y: 150 }, 15)
    .map((w, i) => ({ ...w, id: `existing-${i}`, thickness: 15, height: 280, color: '#444' } as Wall));
  const start = { x: 400, y: 300 };
  const target = { x: 207.5, y: 157.5 };
  const snapped = oppositeRoomCorner(start, { x: 211, y: 154 }, walls, 18, 15, '', '')!;
  expect(snapped.corner.point).toEqual(target);
  expect(snapped.interiorEnd).toEqual({ x: 215, y: 165 });
  const boundary = roomBoundary(start, snapped.interiorEnd, 15, null, snapped.corner);
  expect(boundary[2].start).toEqual(target);
  expect(boundary[0].start).toEqual({ x: 407.5, y: 307.5 });
  expect(Math.abs(snapped.interiorEnd.x - start.x)).toBe(185);
  expect(Math.abs(snapped.interiorEnd.y - start.y)).toBe(135);
  expect(oppositeRoomCorner(start, { x: 211, y: 154 }, walls, 18, 15, '185', '135')).not.toBeNull();
  expect(oppositeRoomCorner(start, { x: 211, y: 154 }, walls, 18, 15, '200', '135')).toBeNull();
});

test('top-right draft corner highlights and aligns a shared wall while pointer stays bottom-right', () => {
  const walls = roomBoundary({ x: 0, y: 0 }, { x: 200, y: 150 }, 15)
    .map((w, i) => ({ ...w, id: `existing-${i}`, thickness: 15, height: 280, color: '#444' } as Wall));
  const anchor = snapRoomCorner({ x: -7.5, y: 157.5 }, walls, 18, 15)!;
  const start = roomInteriorCorner(anchor, { x: 203, y: 300 });
  expect(start).toEqual({ x: 0, y: 165 });
  const aligned = alignedRoomCorner(start, { x: 203, y: 300 }, walls, 18, 15, anchor, '', '')!;
  expect(aligned.axis).toBe('x');
  expect(aligned.corner.point).toEqual({ x: 207.5, y: 157.5 });
  expect(aligned.interiorEnd).toEqual({ x: 200, y: 300 });
  const boundary = roomBoundary(start, aligned.interiorEnd, 15, anchor, null, aligned);
  const added = missingRoomWalls(boundary, walls);
  expect(added).toHaveLength(3);
  expect(detectRooms([...walls, ...added.map((w, i) => ({ ...w, id: `new-${i}`, thickness: 15, height: 280, color: '#444' } as Wall))])).toHaveLength(2);
  expect(alignedRoomCorner(start, { x: 203, y: 300 }, walls, 18, 15, anchor, '200', '')).not.toBeNull();
  expect(alignedRoomCorner(start, { x: 203, y: 300 }, walls, 18, 15, anchor, '225', '')).toBeNull();
});

test('keeps the first corner and uses the pointer quadrant for exact dimensions', () => {
  const start = { x: 100, y: 200 };
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    expect(roomDrawingEnd(start, { x: start.x + x * 10, y: start.y + y * 10 }, '525', '650'))
      .toEqual({ x: 100 + x * 525, y: 200 + y * 650 });
  }
});

test('typing only width locks width while length follows the pointer', () => {
  expect(roomDrawingEnd({ x: 0, y: 0 }, { x: -20, y: 300 }, '525,5', ''))
    .toEqual({ x: -525.5, y: 300 });
});

test('400 by 300 cm produces 400 by 300 clear spans in every drawing direction', () => {
  for (const thickness of [10, 15, 30]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const placement = roomDrawingPlacement({ x: 0, y: 0 }, { x: x * 400, y: y * 300 }, thickness);
    const walls = roomPresets.find(p => p.id === 'rectangle')!.getWalls(placement.width, placement.length)
      .map((wall, i) => ({ ...wall, id: String(i), thickness, height: 280, color: '#444' } as Wall));
    const spans = walls.map(wall => {
      const inset = wallEdgeInsets(wall, walls);
      return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) - inset.start - inset.end;
    });
    expect(spans).toEqual([400, 300, 400, 300]);
    expect(placement.center).toEqual({ x: x * 200, y: y * 150 });
  }
});
