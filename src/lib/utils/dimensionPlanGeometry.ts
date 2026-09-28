import type { Annotation, Point, Wall } from '$lib/models/types';

/** Anchor a selected wall's dimension on the chosen face, between adjoining inner faces. */
export function wallFaceDimensionSpan(
  wall: Wall, insets: { start: number; end: number }, pointer: Point
): { start: Point; end: Point } | null {
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || insets.start + insets.end >= length) return null;
  const ux = dx / length, uy = dy / length;
  const side = dimensionOffsetAt(wall.start, wall.end, pointer) < 0 ? -1 : 1;
  const nx = -uy * wall.thickness / 2 * side, ny = ux * wall.thickness / 2 * side;
  return {
    start: { x: wall.start.x + ux * insets.start + nx, y: wall.start.y + uy * insets.start + ny },
    end: { x: wall.end.x - ux * insets.end + nx, y: wall.end.y - uy * insets.end + ny }
  };
}

/** Two snapped endpoints of one wall use the same inside span as wall selection. */
export function snappedWallEndpointSpan(
  start: Point, end: Point, pointer: Point, walls: Wall[],
  insetsForWall: (wall: Wall) => { start: number; end: number }
): { start: Point; end: Point } | null {
  const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
  for (const wall of walls) {
    if (wall.curvePoint) continue;
    const forward = same(start, wall.start) && same(end, wall.end);
    const reverse = same(start, wall.end) && same(end, wall.start);
    if (!forward && !reverse) continue;
    const span = wallFaceDimensionSpan(wall, insetsForWall(wall), pointer);
    if (span) return reverse ? { start: span.end, end: span.start } : span;
  }
  return null;
}

/** Shorten a two-point dimension to the inner faces at its endpoints. */
export function insetDimensionSpan(
  start: Point, end: Point, insets: { start: number; end: number }
): { start: Point; end: Point } | null {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || insets.start + insets.end >= length) return null;
  const ux = dx / length, uy = dy / length;
  return {
    start: { x: start.x + ux * insets.start, y: start.y + uy * insets.start },
    end: { x: end.x - ux * insets.end, y: end.y - uy * insets.end }
  };
}

/** Signed perpendicular distance from a measured segment to the pointer. */
export function dimensionOffsetAt(start: Point, end: Point, pointer: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return 0;
  return ((pointer.x - start.x) * -dy + (pointer.y - start.y) * dx) / length;
}
export function dimensionPlanGeometry(a: Annotation) {
  const dx=a.x2-a.x1,dy=a.y2-a.y1,length=Math.hypot(dx,dy);
  if(length<1)return null;
  const ux=dx/length,uy=dy/length,nx=-uy,ny=ux,offset=a.offset??40;
  const start={x:a.x1+nx*offset,y:a.y1+ny*offset},end={x:a.x2+nx*offset,y:a.y2+ny*offset};
  return {length,ux,uy,nx,ny,start,end,center:{x:(start.x+end.x)/2,y:(start.y+end.y)/2}};
}
