import type { Point, Wall } from '$lib/models/types';

export interface RoomCorner { point: Point; xThickness: number; yThickness: number }
const EPS = 0.001;
const horizontal = (w: Wall) => !w.curvePoint && Math.abs(w.start.y - w.end.y) < EPS;
const vertical = (w: Wall) => !w.curvePoint && Math.abs(w.start.x - w.end.x) < EPS;

export function snapRoomCorner(pointer: Point, walls: Wall[], radius: number, thickness: number): RoomCorner | null {
  let point: Point | null = null, distance = radius;
  for (const wall of walls) {
    if (!horizontal(wall) && !vertical(wall)) continue;
    for (const p of [wall.start, wall.end]) {
      const d = Math.hypot(pointer.x - p.x, pointer.y - p.y);
      if (d < distance) { distance = d; point = p; }
    }
  }
  if (!point) return null;
  const touching = walls.filter(w => [w.start, w.end].some(p => Math.hypot(p.x - point!.x, p.y - point!.y) < EPS));
  return { point: { ...point },
    xThickness: Math.max(0, ...touching.filter(vertical).map(w => w.thickness)) || thickness,
    yThickness: Math.max(0, ...touching.filter(horizontal).map(w => w.thickness)) || thickness };
}

export function roomInteriorCorner(anchor: RoomCorner, pointer: Point): Point {
  return { x: anchor.point.x + (pointer.x < anchor.point.x ? -1 : 1) * anchor.xThickness / 2,
    y: anchor.point.y + (pointer.y < anchor.point.y ? -1 : 1) * anchor.yThickness / 2 };
}

/** Snap the opposite corner while preserving any exact dimensions already typed. */
export function oppositeRoomCorner(
  start: Point, pointer: Point, walls: Wall[], radius: number, thickness: number,
  widthText: string, lengthText: string,
): { corner: RoomCorner; interiorEnd: Point } | null {
  const corner = snapRoomCorner(pointer, walls, radius, thickness);
  if (!corner) return null;
  const interiorEnd = roomInteriorCorner(corner, start);
  const width = Math.abs(interiorEnd.x - start.x), length = Math.abs(interiorEnd.y - start.y);
  if (width < 1 || length < 1) return null;
  const typedWidth = parseRoomDimension(widthText), typedLength = parseRoomDimension(lengthText);
  if ((typedWidth !== null && Math.abs(width - typedWidth) > 0.01)
    || (typedLength !== null && Math.abs(length - typedLength) > 0.01)) return null;
  return { corner, interiorEnd };
}

/** Align a side of the draft rectangle with an existing endpoint near that side's corner. */
export function alignedRoomCorner(
  start: Point, end: Point, walls: Wall[], radius: number, thickness: number,
  anchor: RoomCorner | null, widthText: string, lengthText: string,
): { corner: RoomCorner; axis: 'x' | 'y' | 'both'; interiorEnd: Point } | null {
  const boundary = roomBoundary(start, end, thickness, anchor);
  const candidates = [
    { point: boundary[0].end, axis: 'x' as const },
    { point: boundary[1].end, axis: 'both' as const },
    { point: boundary[2].end, axis: 'y' as const },
  ];
  let result: { corner: RoomCorner; axis: 'x' | 'y' | 'both'; interiorEnd: Point } | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    const corner = snapRoomCorner(candidate.point, walls, radius, thickness);
    if (!corner) continue;
    const distance = Math.hypot(candidate.point.x - corner.point.x, candidate.point.y - corner.point.y);
    if (distance >= bestDistance) continue;
    const sx = end.x < start.x ? -1 : 1, sy = end.y < start.y ? -1 : 1;
    const interiorEnd = {
      x: candidate.axis === 'y' ? end.x : corner.point.x - sx * corner.xThickness / 2,
      y: candidate.axis === 'x' ? end.y : corner.point.y - sy * corner.yThickness / 2,
    };
    const width = Math.abs(interiorEnd.x - start.x), length = Math.abs(interiorEnd.y - start.y);
    if (width < 1 || length < 1) continue;
    const typedWidth = parseRoomDimension(widthText), typedLength = parseRoomDimension(lengthText);
    if ((typedWidth !== null && Math.abs(width - typedWidth) > 0.01)
      || (typedLength !== null && Math.abs(length - typedLength) > 0.01)) continue;
    bestDistance = distance;
    result = { corner, axis: candidate.axis, interiorEnd };
  }
  return result;
}

export function roomBoundary(start: Point, end: Point, thickness: number, anchor: RoomCorner | null = null, opposite: RoomCorner | null = null,
  aligned: { corner: RoomCorner; axis: 'x' | 'y' | 'both' } | null = null) {
  const sx = end.x < start.x ? -1 : 1, sy = end.y < start.y ? -1 : 1;
  const a = anchor?.point ?? { x: start.x - sx * thickness / 2, y: start.y - sy * thickness / 2 };
  const b = opposite?.point ?? {
    x: aligned && aligned.axis !== 'y' ? aligned.corner.point.x : end.x + sx * thickness / 2,
    y: aligned && aligned.axis !== 'x' ? aligned.corner.point.y : end.y + sy * thickness / 2,
  };
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  return corners.map((p, i) => ({ start: p, end: corners[(i + 1) % 4] }));
}

/** Reuse existing collinear spans; leave their IDs, openings and metadata intact. */
export function missingRoomWalls(boundary: { start: Point; end: Point }[], walls: Wall[]) {
  return boundary.flatMap(edge => {
    const h = Math.abs(edge.start.y - edge.end.y) < EPS;
    const axis = h ? 'x' : 'y', fixed = h ? 'y' : 'x';
    let gaps = [[Math.min(edge.start[axis], edge.end[axis]), Math.max(edge.start[axis], edge.end[axis])]];
    for (const wall of walls) {
      if (!(h ? horizontal(wall) : vertical(wall)) || Math.abs(wall.start[fixed] - edge.start[fixed]) > EPS) continue;
      const lo = Math.min(wall.start[axis], wall.end[axis]), hi = Math.max(wall.start[axis], wall.end[axis]);
      gaps = gaps.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b]] : [[a, Math.max(a, lo)], [Math.min(b, hi), b]].filter(([x, y]) => y - x > EPS));
    }
    return gaps.filter(([a, b]) => b - a > EPS).map(([a, b]) => ({
      start: h ? { x: a, y: edge.start.y } : { x: edge.start.x, y: a },
      end: h ? { x: b, y: edge.start.y } : { x: edge.start.x, y: b },
    }));
  });
}

/** The clicked rectangle is the clear interior; wall centerlines sit half a thickness outside it. */
export function roomDrawingPlacement(start: Point, end: Point, thickness: number) {
  return {
    center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    width: Math.abs(end.x - start.x) + thickness,
    length: Math.abs(end.y - start.y) + thickness,
  };
}

/** One dimension in centimeters, accepting decimal points and commas. */
export function parseRoomDimension(text: string): number | null {
  if (!/^(\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text.trim())) return null;
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value >= 1 ? value : null;
}

export function roomDrawingEnd(start: Point, pointer: Point, widthText: string, lengthText: string): Point {
  const width = parseRoomDimension(widthText), length = parseRoomDimension(lengthText);
  return {
    x: width === null ? pointer.x : start.x + (pointer.x < start.x ? -1 : 1) * width,
    y: length === null ? pointer.y : start.y + (pointer.y < start.y ? -1 : 1) * length,
  };
}
