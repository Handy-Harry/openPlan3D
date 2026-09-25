import { prepareEntourageImage } from './entourageImages';
import type { Locale } from '$lib/i18n';
import { furnitureName } from '$lib/i18n/furnitureNames';
import { roomHoles, traceRoomRings } from './roomNesting';
import { getEntourageDef } from './entourageCatalog';
import { entouragePlanBounds } from './entouragePlanBounds';
import { planContentBounds } from './planContentBounds';
import { columnPlanBounds } from './columnPlanGeometry';
import { hasPlanExportContent } from './planExportContent';
import { dimensionPlanGeometry } from './dimensionPlanGeometry';
import { textAnnotationBounds, textAnnotationLines } from './textAnnotationLayout';
import { canvasSymbolSvg } from './canvasSymbolSvg';
import { furnitureSvg } from './furnitureSvg';
import { furniturePlanBounds } from './furniturePlanBounds';
import { canvasPNG } from './canvasPNG';
import { planOpening } from './planOpening';
import { wallPlanBounds, wallPlanDimension } from './wallPlanGeometry';
import type { Project, Floor, Room, Point, Window as PlanWindow } from '$lib/models/types';
import { getCatalogItem, getFurnitureSize } from '$lib/utils/furnitureCatalog';
import { resolveRooms, getRoomPolygon, roomLabelPosition, roomCentroid } from '$lib/utils/roomDetection';
import { drawStair, drawFurnitureItem, drawColumn, drawDoorOnWall, drawWindowOnWall, drawEntourageItems, drawTextAnnotations, drawAnnotations, drawPersistedMeasurements } from '$lib/utils/canvasRenderer';
import type { CanvasState } from '$lib/utils/canvasInteraction';
import { projectSettings, formatArea, formatLength } from '$lib/stores/settings';
import { roomPlanHeight } from '$lib/utils/wallProfiles';
import { get } from 'svelte/store';
import jsPDF from 'jspdf';

/** Escape text for safe SVG embedding */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Extend plan bounds so door swing arcs (radius up to door width) aren't clipped.
 */
function extendBoundsForOpenings(
  floor: Floor,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
) {
  for (const d of floor.doors) {
    const wall = floor.walls.find(w => w.id === d.wallId);
    if (!wall) continue;
    const frame = planOpening(wall, d.position, d.width);
    if (!frame) continue;
    const px = frame.wall.start.x + (frame.wall.end.x - frame.wall.start.x) * frame.position;
    const py = frame.wall.start.y + (frame.wall.end.y - frame.wall.start.y) * frame.position;
    bounds.minX = Math.min(bounds.minX, px - d.width);
    bounds.minY = Math.min(bounds.minY, py - d.width);
    bounds.maxX = Math.max(bounds.maxX, px + d.width);
    bounds.maxY = Math.max(bounds.maxY, py + d.width);
  }
}

/** Include label ink, not just its anchor, before framing a plan export. */
function extendBoundsForRoomLabels(floor: Floor, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  const rooms = resolveRooms(floor), polygons = rooms.map(room=>getRoomPolygon(room,floor.walls));
  const holes = roomHoles(polygons);
  for (const [index,room] of rooms.entries()) {
    const poly = polygons[index];
    if (poly.length < 3) continue;
    const anchor = roomLabelPosition(room, poly, holes[index]);
    ctx.font = 'bold 13px sans-serif';
    const nameWidth = ctx.measureText(room.name).width;
    ctx.font = '11px sans-serif';
    const width = Math.max(nameWidth, ctx.measureText(formatArea(room.area, get(projectSettings).units)).width);
    bounds.minX = Math.min(bounds.minX, anchor.x - width / 2);
    bounds.maxX = Math.max(bounds.maxX, anchor.x + width / 2);
    bounds.minY = Math.min(bounds.minY, anchor.y - 13);
    bounds.maxY = Math.max(bounds.maxY, anchor.y + 18);
  }
}

function extendBoundsForMeasurements(floor: Floor, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  ctx.font = 'bold 12px sans-serif';
  for (const m of floor.measurements ?? []) {
    const width = ctx.measureText(formatLength(Math.hypot(m.x2-m.x1,m.y2-m.y1),get(projectSettings).units)).width;
    const x=(m.x1+m.x2)/2,y=(m.y1+m.y2)/2;
    bounds.minX=Math.min(bounds.minX,m.x1-3,m.x2-3,x-width/2-2);
    bounds.maxX=Math.max(bounds.maxX,m.x1+3,m.x2+3,x+width/2+2);
    bounds.minY=Math.min(bounds.minY,m.y1-3,m.y2-3,y-20);
    bounds.maxY=Math.max(bounds.maxY,m.y1+3,m.y2+3,y+2);
  }
}

function extendBoundsForDimensions(floor: Floor, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  ctx.font = '11px sans-serif';
  for (const note of floor.annotations ?? []) {
    const g = dimensionPlanGeometry(note);
    if (!g) continue;
    const width = ctx.measureText(note.label || formatLength(g.length, get(projectSettings).units)).width;
    const points = [{x:note.x1,y:note.y1},{x:note.x2,y:note.y2},g.start,g.end,
      {x:g.center.x-width/2,y:g.center.y-11},{x:g.center.x+width/2,y:g.center.y+11}];
    bounds.minX=Math.min(bounds.minX,...points.map(p=>p.x-8)); bounds.minY=Math.min(bounds.minY,...points.map(p=>p.y-8));
    bounds.maxX=Math.max(bounds.maxX,...points.map(p=>p.x+8)); bounds.maxY=Math.max(bounds.maxY,...points.map(p=>p.y+8));
  }
}

/** Reuse the editor's complete stair footprint and rotated caption bounds. */
function extendBoundsForStairs(floor: Floor, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  if (!floor.stairs?.length) return;
  const context=document.createElement('canvas').getContext('2d');
  if (!context) return;
  const b=planContentBounds({...floor,walls:[],doors:[],windows:[],rooms:[],furniture:[],columns:[],entourage:[],measurements:[],annotations:[],textAnnotations:[],backgroundImage:undefined}, {context,entourageAspect:()=>1});
  if (!b) return;
  bounds.minX=Math.min(bounds.minX,b.minX); bounds.minY=Math.min(bounds.minY,b.minY);
  bounds.maxX=Math.max(bounds.maxX,b.maxX); bounds.maxY=Math.max(bounds.maxY,b.maxY);
}

function extendBoundsForColumns(floor: Floor, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  for (const column of floor.columns ?? []) {
    const b = columnPlanBounds(column);
    bounds.minX = Math.min(bounds.minX, b.minX); bounds.minY = Math.min(bounds.minY, b.minY);
    bounds.maxX = Math.max(bounds.maxX, b.maxX); bounds.maxY = Math.max(bounds.maxY, b.maxY);
  }
}

function extendBoundsForText(floor: Floor, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  for (const note of floor.textAnnotations ?? []) {
    const b = textAnnotationBounds(note, ctx);
    bounds.minX = Math.min(bounds.minX, b.minX); bounds.minY = Math.min(bounds.minY, b.minY);
    bounds.maxX = Math.max(bounds.maxX, b.maxX); bounds.maxY = Math.max(bounds.maxY, b.maxY);
  }
}

/**
 * Draw all doors and windows onto an export canvas using the shared
 * full-fidelity renderer. The CanvasState below maps world→canvas as
 * `wx - minX + pad`, matching the export drawing convention.
 */
function drawOpeningsOnCanvas(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  minX: number,
  minY: number,
  pad: number,
) {
  const cs: CanvasState = { ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY };
  for (const opening of [...floor.doors, ...floor.windows]) {
    const source = floor.walls.find(w => w.id === opening.wallId);
    if (!source) continue;
    const frame = planOpening(source, opening.position, opening.width);
    if (!frame) continue;
    if (frame.curve) {
      const { start, control, end } = frame.curve;
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = source.thickness + 2; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(start.x-minX+pad, start.y-minY+pad);
      ctx.quadraticCurveTo(control.x-minX+pad, control.y-minY+pad, end.x-minX+pad, end.y-minY+pad);
      ctx.stroke(); ctx.restore();
    }
    const symbol = { ...opening, position: frame.position, width: frame.width };
    if (floor.doors.includes(opening as typeof floor.doors[number])) drawDoorOnWall(cs, frame.wall, symbol as typeof floor.doors[number]);
    else drawWindowOnWall(cs, frame.wall, symbol as typeof floor.windows[number]);
  }
}

type PdfLabelBox = { left: number; right: number; top: number; bottom: number };

function boxesOverlap(a: PdfLabelBox, b: PdfLabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function roomLabelBox(ctx: CanvasRenderingContext2D, room: Room, polygon: Point[], holes: Point[][],
  floor: Floor, units: 'metric' | 'imperial', minX: number, minY: number, pad: number) {
  const anchor = roomLabelPosition(room, polygon, holes);
  const x = anchor.x - minX + pad, y = anchor.y - minY + pad;
  const xs = polygon.map(point => point.x), ys = polygon.map(point => point.y);
  const minSpan = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const compact = minSpan < 145;
  const nameSize = compact ? 12 : Math.max(15, Math.min(22, minSpan / 8));
  const detailSize = compact ? 11 : Math.max(13, nameSize - 3);
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...ys) - Math.min(...ys);
  const height = roomPlanHeight(room, floor.walls);
  const dimensions = `${formatLength(width, units)} × ${formatLength(depth, units)}${height === undefined ? '' : ` × ${formatLength(height, units)}`}`;
  const lines = compact
    ? [{ text: room.name, size: nameSize, bold: true },
      { text: `${formatArea(room.area, units)}${height === undefined ? '' : ` · H ${formatLength(height, units)}`}`, size: 9, bold: false }]
    : [{ text: room.name, size: nameSize, bold: true }, { text: formatArea(room.area, units), size: detailSize, bold: false },
      { text: dimensions, size: detailSize, bold: false }];
  let textWidth = 0;
  for (const line of lines) {
    ctx.font = `${line.bold ? 'bold ' : ''}${line.size}px sans-serif`;
    textWidth = Math.max(textWidth, ctx.measureText(line.text).width);
  }
  const lineStep = Math.max(...lines.map(line => line.size)) + (compact ? 1 : 4);
  const box = { left: x - textWidth / 2 - 7, right: x + textWidth / 2 + 7,
    top: y - lines.length * lineStep / 2 - (compact ? 2 : 4), bottom: y + lines.length * lineStep / 2 + (compact ? 2 : 4) };
  return { x, y, lines, lineStep, box };
}

function drawPdfRoomAnnotation(ctx: CanvasRenderingContext2D, room: Room, polygon: Point[], holes: Point[][],
  floor: Floor, units: 'metric' | 'imperial', minX: number, minY: number, pad: number) {
  if (polygon.length < 3) return;
  const annotation = roomLabelBox(ctx, room, polygon, holes, floor, units, minX, minY, pad);
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(annotation.box.left, annotation.box.top,
    annotation.box.right - annotation.box.left, annotation.box.bottom - annotation.box.top);
  ctx.fillStyle = '#1e293b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let y = annotation.y - (annotation.lines.length - 1) * annotation.lineStep / 2;
  for (const line of annotation.lines) {
    ctx.font = `${line.bold ? 'bold ' : ''}${line.size}px sans-serif`;
    ctx.fillText(line.text, annotation.x, y);
    y += annotation.lineStep;
  }
  ctx.restore();
}

function drawPdfWindowDimensions(
  ctx: CanvasRenderingContext2D, window: PlanWindow, floor: Floor, roomCenters: Point[],
  units: 'metric' | 'imperial', minX: number, minY: number, pad: number, occupied: PdfLabelBox[],
) {
  const source = floor.walls.find(wall => wall.id === window.wallId);
  if (!source) return;
  const frame = planOpening(source, window.position, window.width);
  if (!frame) return;
  const wall = frame.wall;
  const center = { x: wall.start.x + (wall.end.x - wall.start.x) * frame.position,
    y: wall.start.y + (wall.end.y - wall.start.y) * frame.position };
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const normal = { x: -dy / length, y: dx / length };
  const nearest = roomCenters.reduce<Point | null>((best, point) => !best || Math.hypot(point.x - center.x, point.y - center.y) < Math.hypot(best.x - center.x, best.y - center.y) ? point : best, null);
  const side = nearest && (nearest.x - center.x) * normal.x + (nearest.y - center.y) * normal.y < 0 ? -1 : 1;
  const lines = [`B ${formatLength(window.width, units)}`, `H ${formatLength(window.height, units)}`];
  ctx.save();
  ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const labelWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
  const baseOffset = wall.thickness / 2 + Math.max(45, labelWidth / 2 + 12);
  let chosen: { x: number; y: number; box: PdfLabelBox } | null = null;
  for (const offsetExtra of [0, 30, 60]) {
    for (const along of [0, -window.width / 2 - 30, window.width / 2 + 30]) {
      const x = center.x + normal.x * side * (baseOffset + offsetExtra) + dx / length * along - minX + pad;
      const y = center.y + normal.y * side * (baseOffset + offsetExtra) + dy / length * along - minY + pad;
      const box = { left: x - labelWidth / 2 - 6, right: x + labelWidth / 2 + 6, top: y - 22, bottom: y + 22 };
      if (occupied.some(other => boxesOverlap(box, other))) continue;
      chosen = { x, y, box }; break;
    }
    if (chosen) break;
  }
  if (!chosen) { ctx.restore(); return; }
  occupied.push(chosen.box);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(chosen.box.left, chosen.box.top, labelWidth + 12, 44);
  ctx.fillStyle = '#0f4c5c';
  ctx.fillText(lines[0], chosen.x, chosen.y - 10);
  ctx.fillText(lines[1], chosen.x, chosen.y + 10);
  ctx.restore();
}

/**
 * Export the full floor plan as a high-resolution PNG.
 * Renders all walls/rooms/doors/furniture onto an offscreen canvas
 * so the export isn't limited to the current viewport.
 */
export async function exportAsPNG(canvas: HTMLCanvasElement | null, project?: Project) {
  const name = project?.name || 'floorplan';

  if (project) {
    const snapshot=structuredClone(project);
    const floor = snapshot.floors.find(f => f.id === snapshot.activeFloorId) ?? snapshot.floors[0];
    const entourage=(floor?.entourage ?? []).flatMap(item=>{
      const def=getEntourageDef(item.defId),custom=def?undefined:snapshot.customEntourage?.find(d=>d.id===item.defId);
      return def || custom ? [{item,custom,aspect:def?.aspect ?? custom!.aspect}] : [];
    });
    if (floor && (hasPlanExportContent(floor) || entourage.length)) {
      const preparedImages=new Map(await Promise.all([...new Set(entourage.flatMap(e=>e.custom?[e.custom]:[]))].map(async def=>[def.id,await prepareEntourageImage(def)] as const)));
      // Compute bounds of all geometry
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const w of floor.walls) {
        for (const b of [wallPlanBounds(w)]) {
          minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
          maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
        }
      }

      const bounds = { minX, minY, maxX, maxY };
      for (const item of floor.furniture) {
        const b = furniturePlanBounds(item);
        bounds.minX = Math.min(bounds.minX, b.minX); bounds.minY = Math.min(bounds.minY, b.minY);
        bounds.maxX = Math.max(bounds.maxX, b.maxX); bounds.maxY = Math.max(bounds.maxY, b.maxY);
      }
      for(const {item,aspect} of entourage){const b=entouragePlanBounds(item,aspect);
        bounds.minX=Math.min(bounds.minX,b.minX-2);bounds.minY=Math.min(bounds.minY,b.minY-2);
        bounds.maxX=Math.max(bounds.maxX,b.maxX+2);bounds.maxY=Math.max(bounds.maxY,b.maxY+2);
      }
      extendBoundsForOpenings(floor, bounds);
      extendBoundsForRoomLabels(floor, bounds);
      extendBoundsForColumns(floor, bounds);
      extendBoundsForStairs(floor, bounds);
      extendBoundsForText(floor, bounds);
      extendBoundsForDimensions(floor, bounds);
      extendBoundsForMeasurements(floor, bounds);
      ({ minX, minY, maxX, maxY } = bounds);
      const pad = 80;
      const w = maxX - minX + pad * 2;
      const h = maxY - minY + pad * 2;
      // Prefer 2x resolution, bounded to 4096 pixels per side.
      const scale = Math.min(2, 4096 / Math.max(w, h));
      const offscreen = document.createElement('canvas');
      // Canvas dimensions truncate fractions, including 4095.9999999999995
      // from a capped scale. Round up to retain the complete drawing extent.
      offscreen.width = Math.min(4096, Math.ceil(w * scale));
      offscreen.height = Math.min(4096, Math.ceil(h * scale));
      const ctx = offscreen.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, w, h);

      // Draw room fills
      const ROOM_COLORS = ['#bfdbfe', '#fde68a', '#bbf7d0', '#fecaca', '#ddd6fe', '#a5f3fc', '#fed7aa'];
      const rooms = resolveRooms(floor);
      const polygons = rooms.map(room => getRoomPolygon(room, floor.walls));
      const holes = roomHoles(polygons);
      for (let ri = 0; ri < rooms.length; ri++) {
        const room = rooms[ri];
        const poly = polygons[ri];
        if (poly.length < 3) continue;
        ctx.fillStyle = ROOM_COLORS[ri % ROOM_COLORS.length];
        ctx.globalAlpha = 0.4;
        traceRoomRings(ctx, poly, holes[ri], p => ({x:p.x-minX+pad,y:p.y-minY+pad}));
        if (!room.floorOpening) ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        // Room label
        const c = roomLabelPosition(room, poly, holes[ri]);
        ctx.fillStyle = '#444';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(room.name, c.x - minX + pad, c.y - minY + pad);
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.fillText(formatArea(room.area, get(projectSettings).units), c.x - minX + pad, c.y - minY + pad + 14);
      }

      // Draw walls
      ctx.strokeStyle = '#333';
      ctx.lineCap = 'round';
      for (const wall of floor.walls) {
        ctx.lineWidth = wall.thickness;
        ctx.beginPath();
        ctx.moveTo(wall.start.x - minX + pad, wall.start.y - minY + pad);
        if (wall.curvePoint) ctx.quadraticCurveTo(wall.curvePoint.x - minX + pad, wall.curvePoint.y - minY + pad, wall.end.x - minX + pad, wall.end.y - minY + pad);
        else ctx.lineTo(wall.end.x - minX + pad, wall.end.y - minY + pad);
        ctx.stroke();
        // Dimension label
        const { length: len, point: midpoint } = wallPlanDimension(wall);
        const mx = midpoint.x - minX + pad;
        const my = midpoint.y - minY + pad;
        ctx.fillStyle = '#666';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${len} cm`, mx, my);
      }

      // Entourage images are ready before the export is drawn.
      if (floor.entourage?.length) {
        drawEntourageItems({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, snapshot.customEntourage, undefined, preparedImages);
      }

      // Draw doors and windows (shared full-fidelity renderer)
      drawOpeningsOnCanvas(ctx, floor, minX, minY, pad);

      for (const item of floor.furniture) drawFurnitureItem({
        ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY,
      }, item, false);

      ctx.save();
      for (const stair of floor.stairs ?? []) drawStair({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, stair, false);
      for (const column of floor.columns ?? []) drawColumn({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, column, false);
      drawPersistedMeasurements({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, get(projectSettings));
      ctx.restore();
      drawAnnotations({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, get(projectSettings));
      drawTextAnnotations({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, null);

      // Title
      ctx.fillStyle = '#222';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${name} — ${floor.name}`, 20, 24);

      download(await canvasPNG(offscreen), `${name}.png`);
      return true;
    }
  }

  // Project exports never substitute an unrelated viewport for an empty floor.
  if (project) return false;
  if (!canvas) throw new Error('No viewport available');
  download(await canvasPNG(canvas), `${name}-2d.png`);
  return true;
}

export { downloadProjectJSON as exportAsJSON } from './projectBackup';

export function exportAsSVG(project: Project, language: Locale = 'en') {
  const floor = project.floors.find(f => f.id === project.activeFloorId) ?? project.floors[0];
  if (!floor) return;
  const entourage=(floor.entourage ?? []).flatMap(item=>{
    const def=getEntourageDef(item.defId), custom=def?undefined:project.customEntourage?.find(d=>d.id===item.defId);
    return def || custom ? [{item,def,custom,aspect:def?.aspect ?? custom!.aspect}] : [];
  });
  if (!hasPlanExportContent(floor) && !entourage.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of floor.walls) {
    for (const b of [wallPlanBounds(w)]) {
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
  }
  const svgBounds = { minX, minY, maxX, maxY };
  for (const item of floor.furniture) {
    const b = furniturePlanBounds(item);
    svgBounds.minX = Math.min(svgBounds.minX, b.minX); svgBounds.minY = Math.min(svgBounds.minY, b.minY);
    svgBounds.maxX = Math.max(svgBounds.maxX, b.maxX); svgBounds.maxY = Math.max(svgBounds.maxY, b.maxY);
  }
  for (const {item,aspect} of entourage) {
    const b=entouragePlanBounds(item,aspect);
    svgBounds.minX=Math.min(svgBounds.minX,b.minX-2);svgBounds.minY=Math.min(svgBounds.minY,b.minY-2);
    svgBounds.maxX=Math.max(svgBounds.maxX,b.maxX+2);svgBounds.maxY=Math.max(svgBounds.maxY,b.maxY+2);
  }
  extendBoundsForOpenings(floor, svgBounds);
  extendBoundsForRoomLabels(floor, svgBounds);
  extendBoundsForColumns(floor, svgBounds);
  extendBoundsForStairs(floor, svgBounds);
  extendBoundsForText(floor, svgBounds);
  extendBoundsForDimensions(floor, svgBounds);
  extendBoundsForMeasurements(floor, svgBounds);
  ({ minX, minY, maxX, maxY } = svgBounds);
  const pad = 50;
  const vw = maxX - minX + pad * 2;
  const vh = maxY - minY + pad * 2;

  let paths = '';

  // Room fills
  const ROOM_COLORS_SVG = ['#bfdbfe', '#fde68a', '#bbf7d0', '#fecaca', '#ddd6fe', '#a5f3fc', '#fed7aa'];
  const rooms = resolveRooms(floor);
  const polygons = rooms.map(room => getRoomPolygon(room, floor.walls));
  const holes = roomHoles(polygons);
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const poly = polygons[ri];
    if (poly.length < 3) continue;
    const pts = poly.map(p => `${p.x - minX + pad},${p.y - minY + pad}`).join(' ');
    const color = room.floorOpening ? 'none' : ROOM_COLORS_SVG[ri % ROOM_COLORS_SVG.length];
    if (holes[ri].length) {
      const d = [poly,...holes[ri]].map(ring => `M ${ring.map(p=>`${p.x-minX+pad},${p.y-minY+pad}`).join(' L ')} Z`).join(' ');
      paths += `  <path d="${d}" fill="${color}" fill-rule="evenodd" fill-opacity="0.4" stroke="none"/>\n`;
    } else paths += `  <polygon points="${pts}" fill="${color}" fill-opacity="0.4" stroke="none"/>\n`;
    const c = roomLabelPosition(room, poly, holes[ri]);
    const cx = c.x - minX + pad;
    const cy = c.y - minY + pad;
    paths += `  <text x="${cx}" y="${cy}" text-anchor="middle" font-size="12" fill="#444" font-family="sans-serif" font-weight="bold">${escapeXml(room.name)}</text>\n`;
    paths += `  <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#888" font-family="sans-serif">${formatArea(room.area, get(projectSettings).units)}</text>\n`;
  }

  for (const w of floor.walls) {
    const x1 = w.start.x - minX + pad;
    const y1 = w.start.y - minY + pad;
    const x2 = w.end.x - minX + pad;
    const y2 = w.end.y - minY + pad;
    if (w.curvePoint) paths += `  <path d="M ${x1} ${y1} Q ${w.curvePoint.x - minX + pad} ${w.curvePoint.y - minY + pad} ${x2} ${y2}" fill="none" stroke="#333" stroke-width="${w.thickness}" stroke-linecap="round"/>\n`;
    else paths += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="${w.thickness}" stroke-linecap="round"/>\n`;
    // dimension label
    const { length: len, point: midpoint } = wallPlanDimension(w);
    const mx = midpoint.x - minX + pad;
    const my = midpoint.y - minY + pad;
    paths += `  <text x="${mx}" y="${my}" text-anchor="middle" font-size="11" fill="#666" font-family="sans-serif">${len} cm</text>\n`;
  }

  for (const {item,def,custom,aspect} of entourage) {
    const width=item.width,height=width*aspect,scale=width/100;
    paths+=`<g data-entourage="${escapeXml(item.id)}" transform="translate(${item.position.x-minX+pad},${item.position.y-minY+pad}) rotate(${item.rotation || 0})" opacity="${item.opacity ?? 1}">`;
    if (def && scale>.01) {
      paths+=`<g transform="scale(${scale}) translate(-50,${-50*aspect})" fill="none" stroke="#4b5563" stroke-width="${Math.min(1.6/scale,4)}" stroke-linejoin="round" stroke-linecap="round">`;
      for (const path of def.paths) paths+=`<path d="${escapeXml(path)}"/>`;
      paths+='</g>';
    } else if (custom) paths+=`<image href="${escapeXml(custom.dataUrl)}" x="${-width/2}" y="${-height/2}" width="${width}" height="${height}" preserveAspectRatio="none"/>`;
    paths+='</g>\n';
  }

  // Doors: wall gap + jambs + type-specific glyph (swing arc / panels)
  const n2 = (v: number) => v.toFixed(2);
  for (const original of floor.doors) {
    const source = floor.walls.find(w => w.id === original.wallId);
    if (!source) continue;
    const frame = planOpening(source, original.position, original.width);
    if (!frame) continue;
    const wall = frame.wall, d = { ...original, position: frame.position, width: frame.width };
    if (frame.curve) {
      const { start, control, end } = frame.curve;
      paths += `  <path d="M ${start.x-minX+pad} ${start.y-minY+pad} Q ${control.x-minX+pad} ${control.y-minY+pad} ${end.x-minX+pad} ${end.y-minY+pad}" fill="none" stroke="white" stroke-width="${source.thickness+2}" stroke-linecap="butt"/>\n`;
    }
    const wdx = wall.end.x - wall.start.x;
    const wdy = wall.end.y - wall.start.y;
    const wlen = Math.hypot(wdx, wdy) || 1;
    const ux = wdx / wlen, uy = wdy / wlen;
    const nx = -uy, ny = ux;
    const px = wall.start.x + wdx * d.position - minX + pad;
    const py = wall.start.y + wdy * d.position - minY + pad;
    const hw = d.width / 2;
    const th = Math.max(wall.thickness, 4) / 2 + 1;
    const wallAngle = Math.atan2(uy, ux);
    const swingDir = d.swingDirection === 'left' ? 1 : -1;
    const sideFlip = (d.flipSide ?? false) ? -1 : 1;

    // Clear the wall gap
    const gapPts = [
      [px - ux * hw + nx * th, py - uy * hw + ny * th],
      [px + ux * hw + nx * th, py + uy * hw + ny * th],
      [px + ux * hw - nx * th, py + uy * hw - ny * th],
      [px - ux * hw - nx * th, py - uy * hw - ny * th],
    ].map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ');
    paths += `  <polygon points="${gapPts}" fill="white"/>\n`;

    // Jamb ticks
    for (const sign of [-1, 1]) {
      const jx = px + ux * hw * sign;
      const jy = py + uy * hw * sign;
      paths += `  <line x1="${n2(jx + nx * (th + 1))}" y1="${n2(jy + ny * (th + 1))}" x2="${n2(jx - nx * (th + 1))}" y2="${n2(jy - ny * (th + 1))}" stroke="#444" stroke-width="1.5"/>\n`;
    }

    const doorType = d.type || 'single';
    const svgArc = (hx: number, hy: number, r: number, a0: number, a1: number) => {
      const x0 = hx + r * Math.cos(a0), y0 = hy + r * Math.sin(a0);
      const x1 = hx + r * Math.cos(a1), y1 = hy + r * Math.sin(a1);
      return {
        path: `M ${n2(x0)} ${n2(y0)} A ${n2(r)} ${n2(r)} 0 0 ${a1 > a0 ? 1 : 0} ${n2(x1)} ${n2(y1)}`,
        ex: x1, ey: y1,
      };
    };

    if (doorType === 'single' || doorType === 'pocket') {
      const r = d.width;
      const hx = px + ux * hw * swingDir;
      const hy = py + uy * hw * swingDir;
      const sa = wallAngle + (swingDir === 1 ? Math.PI : 0);
      const ea = sa + (-swingDir) * sideFlip * (Math.PI / 2);
      if (doorType === 'pocket') {
        paths += `  <line x1="${n2(hx)}" y1="${n2(hy)}" x2="${n2(hx + ux * d.width * swingDir)}" y2="${n2(hy + uy * d.width * swingDir)}" stroke="#999" stroke-width="2" stroke-dasharray="4,3"/>\n`;
      } else {
        const arc = svgArc(hx, hy, r, sa, ea);
        paths += `  <path d="${arc.path}" fill="none" stroke="#666" stroke-width="1"/>\n`;
      }
      const panelAngle = doorType === 'pocket' ? sa : ea;
      paths += `  <line x1="${n2(hx)}" y1="${n2(hy)}" x2="${n2(hx + r * Math.cos(panelAngle))}" y2="${n2(hy + r * Math.sin(panelAngle))}" stroke="#444" stroke-width="2.5"/>\n`;
      paths += `  <circle cx="${n2(hx)}" cy="${n2(hy)}" r="2.5" fill="#444"/>\n`;
    } else if (doorType === 'double' || doorType === 'french') {
      const r = hw;
      for (const side of [-1, 1] as const) {
        const hx = px + ux * hw * side;
        const hy = py + uy * hw * side;
        const arcSwing = side === -1 ? swingDir : -swingDir;
        const sa = wallAngle + Math.PI * (side === 1 ? 1 : 0);
        const ea = sa + arcSwing * sideFlip * (Math.PI / 2);
        const arc = svgArc(hx, hy, r, sa, ea);
        paths += `  <path d="${arc.path}" fill="none" stroke="#666" stroke-width="1"/>\n`;
        paths += `  <line x1="${n2(hx)}" y1="${n2(hy)}" x2="${n2(hx + r * Math.cos(ea))}" y2="${n2(hy + r * Math.sin(ea))}" stroke="#444" stroke-width="2.5"/>\n`;
        paths += `  <circle cx="${n2(hx)}" cy="${n2(hy)}" r="2" fill="#444"/>\n`;
      }
    } else if (doorType === 'sliding') {
      const panelW = hw * 0.9;
      const offset = Math.max(wall.thickness, 4) * 0.15 * sideFlip;
      paths += `  <line x1="${n2(px - ux * hw)}" y1="${n2(py - uy * hw)}" x2="${n2(px + ux * panelW * 0.1)}" y2="${n2(py + uy * panelW * 0.1)}" stroke="#444" stroke-width="2"/>\n`;
      paths += `  <line x1="${n2(px - ux * panelW * 0.1 + nx * offset)}" y1="${n2(py - uy * panelW * 0.1 + ny * offset)}" x2="${n2(px + ux * hw + nx * offset)}" y2="${n2(py + uy * hw + ny * offset)}" stroke="#444" stroke-width="2"/>\n`;
    } else if (doorType === 'bifold') {
      const panelCount = 4;
      const panelW = d.width / panelCount;
      const foldAngle = Math.PI / 6;
      let bx = px - ux * hw;
      let by = py - uy * hw;
      let poly = `${n2(bx)},${n2(by)}`;
      for (let i = 0; i < panelCount; i++) {
        const angle = wallAngle + (i % 2 === 0 ? foldAngle * swingDir : -foldAngle * swingDir * 0.3);
        bx += panelW * Math.cos(angle);
        by += panelW * Math.sin(angle);
        poly += ` ${n2(bx)},${n2(by)}`;
      }
      paths += `  <polyline points="${poly}" fill="none" stroke="#444" stroke-width="2"/>\n`;
    } else if (doorType === 'garage') {
      // Overhead garage door: panel line across the opening
      paths += `  <line x1="${n2(px - ux * hw)}" y1="${n2(py - uy * hw)}" x2="${n2(px + ux * hw)}" y2="${n2(py + uy * hw)}" stroke="#444" stroke-width="2.5"/>\n`;
    } else if (doorType === 'opening') {
      // Plain doorway: dashed threshold lines along both wall faces
      for (const side of [-1, 1]) {
        const ox = nx * (th - 1) * side, oy = ny * (th - 1) * side;
        paths += `  <line x1="${n2(px - ux * hw + ox)}" y1="${n2(py - uy * hw + oy)}" x2="${n2(px + ux * hw + ox)}" y2="${n2(py + uy * hw + oy)}" stroke="#999" stroke-width="1" stroke-dasharray="5,4"/>\n`;
      }
    }
  }

  // Windows: wall gap + double-line glyph
  for (const original of floor.windows) {
    const source = floor.walls.find(w => w.id === original.wallId);
    if (!source) continue;
    const frame = planOpening(source, original.position, original.width);
    if (!frame) continue;
    const wall = frame.wall, win = { ...original, position: frame.position, width: frame.width };
    if (frame.curve) {
      const { start, control, end } = frame.curve;
      paths += `  <path d="M ${start.x-minX+pad} ${start.y-minY+pad} Q ${control.x-minX+pad} ${control.y-minY+pad} ${end.x-minX+pad} ${end.y-minY+pad}" fill="none" stroke="white" stroke-width="${source.thickness+2}" stroke-linecap="butt"/>\n`;
    }
    const wdx = wall.end.x - wall.start.x;
    const wdy = wall.end.y - wall.start.y;
    const wlen = Math.hypot(wdx, wdy) || 1;
    const ux = wdx / wlen, uy = wdy / wlen;
    const nx = -uy, ny = ux;
    const px = wall.start.x + wdx * win.position - minX + pad;
    const py = wall.start.y + wdy * win.position - minY + pad;
    const hw = win.width / 2;
    const th = Math.max(wall.thickness, 4) / 2 + 1;
    const gap = Math.max(2, Math.max(wall.thickness, 4) * 0.25);

    const gapPts = [
      [px - ux * hw + nx * th, py - uy * hw + ny * th],
      [px + ux * hw + nx * th, py + uy * hw + ny * th],
      [px + ux * hw - nx * th, py + uy * hw - ny * th],
      [px - ux * hw - nx * th, py - uy * hw - ny * th],
    ].map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ');
    paths += `  <polygon points="${gapPts}" fill="white"/>\n`;

    // Frame lines (double line) + end caps
    for (const s of [-1, 1]) {
      paths += `  <line x1="${n2(px - ux * hw + nx * gap * s)}" y1="${n2(py - uy * hw + ny * gap * s)}" x2="${n2(px + ux * hw + nx * gap * s)}" y2="${n2(py + uy * hw + ny * gap * s)}" stroke="#555" stroke-width="1.5"/>\n`;
      paths += `  <line x1="${n2(px + ux * hw * s + nx * gap)}" y1="${n2(py + uy * hw * s + ny * gap)}" x2="${n2(px + ux * hw * s - nx * gap)}" y2="${n2(py + uy * hw * s - ny * gap)}" stroke="#555" stroke-width="1.5"/>\n`;
    }
  }

  // Shared furniture symbols remain editable vector geometry.
  for (const fi of floor.furniture) {
    const fx=fi.position.x-minX+pad, fy=fi.position.y-minY+pad;
    const cat=getCatalogItem(fi.catalogId), {width:fw,depth:fd}=getFurnitureSize(fi);
    const color=fi.color ?? cat?.color ?? '#888888';
    paths+=`  <g data-furniture="${escapeXml(fi.id)}" data-width="${fw}" data-depth="${fd}" transform="translate(${fx},${fy}) rotate(${fi.rotation || 0})">\n`;
    paths+=`<g transform="scale(${Math.sign(fi.scale?.x ?? 1)||1},${Math.sign(fi.scale?.y ?? 1)||1})">${furnitureSvg(fi.catalogId,fw,fd,color)}</g>\n`;
    const fontSize=Math.max(8,Math.min(12,Math.min(fw,fd)*0.2));
    if(Math.min(fw,fd)>20) paths+=`<text x="0" y="${fd/2+fontSize*0.8}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize*0.7}" fill="#374151" font-family="sans-serif">${escapeXml(cat ? furnitureName(fi.catalogId, language) : 'Unknown furniture')}</text>\n`;
    paths+='  </g>\n';
  }

  for (const stair of floor.stairs ?? []) {
    paths+=`<g data-stair="${escapeXml(stair.id)}">${canvasSymbolSvg(ctx=>drawStair({ctx,width:pad*2,height:pad*2,zoom:1,camX:minX,camY:minY},stair,false))}</g>\n`;
  }
  for (const column of floor.columns ?? []) {
    const x = column.position.x - minX + pad, y = column.position.y - minY + pad;
    const r = column.diameter / 2, rotation = column.shape === 'square' ? column.rotation : 0;
    paths += `  <g data-column="${escapeXml(column.id)}" transform="translate(${x},${y}) rotate(${rotation})">\n`;
    const style = `fill="${escapeXml(column.color)}" stroke="#555" stroke-width="1"`;
    paths += column.shape === 'round'
      ? `    <circle r="${r}" ${style}/>\n`
      : `    <rect x="${-r}" y="${-r}" width="${column.diameter}" height="${column.diameter}" ${style}/>\n`;
    paths += `    <path d="M ${-r} ${-r} L ${r} ${r} M ${-r} ${r} L ${r} ${-r}" fill="none" stroke="#888" stroke-opacity="0.5" stroke-width="0.5"/>\n  </g>\n`;
  }

  // Measurements
  if (floor.measurements) {
    for (const m of floor.measurements) {
      const x1 = m.x1 - minX + pad, y1 = m.y1 - minY + pad;
      const x2 = m.x2 - minX + pad, y2 = m.y2 - minY + pad;
      paths += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ef4444" stroke-width="1" stroke-dasharray="6,3" stroke-linecap="round"/>\n`;
      paths += `  <circle cx="${x1}" cy="${y1}" r="3" fill="#ef4444"/><circle cx="${x2}" cy="${y2}" r="3" fill="#ef4444"/>\n`;
      const label = formatLength(Math.hypot(m.x2-m.x1,m.y2-m.y1), get(projectSettings).units);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      paths += `  <text x="${mx}" y="${my - 6}" text-anchor="middle" font-size="12" fill="#ef4444" font-family="sans-serif" font-weight="bold">${escapeXml(label)}</text>\n`;
    }
  }

  // Annotations (dimension callouts)
  if (floor.annotations) {
    for (const a of floor.annotations) {
      const ax1 = a.x1 - minX + pad, ay1 = a.y1 - minY + pad;
      const ax2 = a.x2 - minX + pad, ay2 = a.y2 - minY + pad;
      const dx = ax2 - ax1, dy = ay2 - ay1;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const offset = a.offset ?? 40;
      const d1x = ax1 + nx * offset, d1y = ay1 + ny * offset;
      const d2x = ax2 + nx * offset, d2y = ay2 + ny * offset;
      // Leader lines
      paths += `  <line x1="${ax1}" y1="${ay1}" x2="${d1x}" y2="${d1y}" stroke="#6366f1" stroke-width="0.75"/>\n`;
      paths += `  <line x1="${ax2}" y1="${ay2}" x2="${d2x}" y2="${d2y}" stroke="#6366f1" stroke-width="0.75"/>\n`;
      // Dimension line
      paths += `  <line x1="${d1x}" y1="${d1y}" x2="${d2x}" y2="${d2y}" stroke="#6366f1" stroke-width="1"/>\n`;
      // Arrowheads
      const arrowLen = 7, arrowW = 3;
      for (const [px, py, dir] of [[d1x, d1y, 1], [d2x, d2y, -1]] as [number, number, number][]) {
        const adx = ux * arrowLen * dir, ady = uy * arrowLen * dir;
        const apx = -uy * arrowW, apy = ux * arrowW;
        paths += `  <polygon points="${px},${py} ${px + adx + apx},${py + ady + apy} ${px + adx - apx},${py + ady - apy}" fill="#6366f1"/>\n`;
      }
      // Label
      const dist = Math.round(Math.hypot(a.x2 - a.x1, a.y2 - a.y1));
      const label = a.label || formatLength(Math.hypot(a.x2-a.x1,a.y2-a.y1), get(projectSettings).units);
      const mx = (d1x + d2x) / 2, my = (d1y + d2y) / 2;
      paths += `  <text x="${mx}" y="${my - 4}" text-anchor="middle" font-size="10" fill="#6366f1" font-family="sans-serif">${escapeXml(label)}</text>\n`;
    }
  }

  // Text annotations
  if (floor.textAnnotations) {
    for (const ta of floor.textAnnotations) {
      const tx = ta.x - minX + pad;
      const ty = ta.y - minY + pad;
      const transform = ta.rotation ? ` transform="rotate(${ta.rotation} ${tx} ${ty})"` : '';
      const { fontSize, lines } = textAnnotationLines(ta);
      paths += `  <text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" fill="${escapeXml(ta.color || '#1e293b')}" font-family="sans-serif" xml:space="preserve"${transform}>${lines.map(line => `<tspan x="${tx}" y="${ty + line.y}">${escapeXml(line.text)}</tspan>`).join('')}</text>\n`;
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}">
  <rect width="100%" height="100%" fill="white"/>
${paths}</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  download(blob, `${project.name || 'floorplan'}.svg`);
}

export function exportAs3DPNG(renderer: { domElement: HTMLCanvasElement }) {
  renderer.domElement.toBlob((blob: Blob | null) => {
    if (blob) download(blob, 'floorplan-3d.png');
  });
}

export async function exportPDF(project: Project) {
  const snapshot=structuredClone(project);
  const floor=snapshot.floors.find(f=>f.id===snapshot.activeFloorId) ?? snapshot.floors[0];
  const definitions=[...new Set((floor?.entourage ?? []).flatMap(item=>{
    const def=getEntourageDef(item.defId)?undefined:snapshot.customEntourage?.find(d=>d.id===item.defId);
    return def?[def]:[];
  }))];
  const preparedImages=new Map(await Promise.all(definitions.map(async def=>[def.id,await prepareEntourageImage(def)] as const)));
  return renderPDF(snapshot,preparedImages);
}

function renderPDF(project: Project, preparedImages: ReadonlyMap<string,HTMLImageElement>) {
  const floor = project.floors.find(f => f.id === project.activeFloorId) ?? project.floors[0];
  if (!floor) return;
  const entourage=(floor.entourage ?? []).flatMap(item=>{
    const def=getEntourageDef(item.defId),custom=def?undefined:project.customEntourage?.find(d=>d.id===item.defId);
    return def || custom ? [{item,aspect:def?.aspect ?? custom!.aspect}] : [];
  });
  if (!hasPlanExportContent(floor) && !entourage.length) return;

  const settings = get(projectSettings);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let pw = pdf.internal.pageSize.getWidth();   // ~297
  let ph = pdf.internal.pageSize.getHeight();   // ~210
  const margin = 10;
  const titleBlockH = 22;

  // ── helpers ──
  function drawPageBorder() {
    pdf.setDrawColor(40);
    pdf.setLineWidth(0.5);
    pdf.rect(margin, margin, pw - margin * 2, ph - margin * 2);
    // inner border
    pdf.setLineWidth(0.15);
    pdf.rect(margin + 1, margin + 1, pw - margin * 2 - 2, ph - margin * 2 - 2);
  }

  function drawTitleBlock() {
    const tbY = ph - margin - titleBlockH;
    const tbW = pw - margin * 2;
    pdf.setDrawColor(40);
    pdf.setLineWidth(0.4);
    pdf.rect(margin, tbY, tbW, titleBlockH);
    // vertical dividers
    const col1 = margin + tbW * 0.45;
    const col2 = margin + tbW * 0.7;
    pdf.line(col1, tbY, col1, tbY + titleBlockH);
    pdf.line(col2, tbY, col2, tbY + titleBlockH);

    // Project name
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text(project.name || 'Untitled Project', margin + 4, tbY + 9);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(floor.name, margin + 4, tbY + 15);
    if (project.description) {
      pdf.setFontSize(7);
      pdf.text(project.description.substring(0, 60), margin + 4, tbY + 19);
    }

    // Date / scale
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    pdf.setFontSize(8);
    pdf.text(`Date: ${today}`, col1 + 4, tbY + 9);
    pdf.text(`Units: ${settings.units}`, col1 + 4, tbY + 15);

    // Office details
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Expertisebureau Peeters & Partners', col2 + 4, tbY + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Stalkerweg 26', col2 + 4, tbY + 12);
    pdf.text('3690 Zutendaal', col2 + 4, tbY + 18);
  }

  // ── Page 1: Floor Plan ──
  // Render floor plan onto an offscreen canvas then embed as image
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of floor.walls) {
    for (const b of [wallPlanBounds(w)]) {
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
  }

  const pdfBounds = { minX, minY, maxX, maxY };
  for (const item of floor.furniture) {
    const b = furniturePlanBounds(item);
    pdfBounds.minX = Math.min(pdfBounds.minX, b.minX); pdfBounds.minY = Math.min(pdfBounds.minY, b.minY);
    pdfBounds.maxX = Math.max(pdfBounds.maxX, b.maxX); pdfBounds.maxY = Math.max(pdfBounds.maxY, b.maxY);
  }
  for(const {item,aspect} of entourage){const b=entouragePlanBounds(item,aspect);
    pdfBounds.minX=Math.min(pdfBounds.minX,b.minX-2);pdfBounds.minY=Math.min(pdfBounds.minY,b.minY-2);
    pdfBounds.maxX=Math.max(pdfBounds.maxX,b.maxX+2);pdfBounds.maxY=Math.max(pdfBounds.maxY,b.maxY+2);
  }
  extendBoundsForOpenings(floor, pdfBounds);
  extendBoundsForRoomLabels(floor, pdfBounds);
  extendBoundsForColumns(floor, pdfBounds);
  extendBoundsForStairs(floor, pdfBounds);
  extendBoundsForText(floor, pdfBounds);
  extendBoundsForDimensions(floor, pdfBounds);
  extendBoundsForMeasurements(floor, pdfBounds);
  ({ minX, minY, maxX, maxY } = pdfBounds);

  const pad = 80;
  const planW = maxX - minX + pad * 2;
  const planH = maxY - minY + pad * 2;
  const landscapeFit = Math.min((297 - margin * 2 - 4) / planW, (210 - margin * 2 - titleBlockH - 6) / planH);
  const portraitFit = Math.min((210 - margin * 2 - 4) / planW, (297 - margin * 2 - titleBlockH - 6) / planH);
  if (portraitFit > landscapeFit * 1.05) {
    pdf.addPage('a4', 'portrait');
    pdf.deletePage(1);
    pdf.setPage(1);
    pw = pdf.internal.pageSize.getWidth();
    ph = pdf.internal.pageSize.getHeight();
  }
  drawPageBorder();
  const scale = Math.min(2, 4096 / Math.max(planW, planH));
  const offscreen = document.createElement('canvas');
  offscreen.width = Math.min(4096, Math.ceil(planW * scale));
  offscreen.height = Math.min(4096, Math.ceil(planH * scale));
  const ctx = offscreen.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, planW, planH);

  const rooms = resolveRooms(floor);
  const polygons = rooms.map(room => getRoomPolygon(room, floor.walls));
  const holes = roomHoles(polygons);
  ctx.save();
  ctx.fillStyle = '#93c5fd';
  ctx.globalAlpha = 0.28;
  rooms.forEach((room, index) => {
    if (room.floorOpening || polygons[index].length < 3) return;
    traceRoomRings(ctx, polygons[index], holes[index], point => ({ x: point.x - minX + pad, y: point.y - minY + pad }));
    ctx.fill('evenodd');
  });
  ctx.restore();

  // Walls
  ctx.strokeStyle = '#333';
  ctx.lineCap = 'round';
  for (const wall of floor.walls) {
    ctx.lineWidth = wall.thickness;
    ctx.beginPath();
    ctx.moveTo(wall.start.x - minX + pad, wall.start.y - minY + pad);
    if (wall.curvePoint) ctx.quadraticCurveTo(wall.curvePoint.x - minX + pad, wall.curvePoint.y - minY + pad, wall.end.x - minX + pad, wall.end.y - minY + pad);
        else ctx.lineTo(wall.end.x - minX + pad, wall.end.y - minY + pad);
    ctx.stroke();
  }

  // Entourage symbols
  if (floor.entourage?.length) {
    drawEntourageItems({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, project.customEntourage, undefined, preparedImages);
  }

  // Doors and windows (shared full-fidelity renderer)
  drawOpeningsOnCanvas(ctx, floor, minX, minY, pad);

  // Reserve room labels so window dimensions do not overlap them.
  const occupiedLabels: PdfLabelBox[] = rooms.flatMap((room, index) => polygons[index].length < 3 ? [] :
    [roomLabelBox(ctx, room, polygons[index], holes[index], floor, settings.units, minX, minY, pad).box]);
  rooms.forEach((room, index) => drawPdfRoomAnnotation(ctx, room, polygons[index], holes[index], floor, settings.units, minX, minY, pad));
  const roomCenters = polygons.filter(poly => poly.length >= 3).map(poly => roomCentroid(poly));
  for (const window of floor.windows) drawPdfWindowDimensions(ctx, window, floor, roomCenters, settings.units, minX, minY, pad, occupiedLabels);

  for (const item of floor.furniture) drawFurnitureItem({
    ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY,
  }, item, false);

  ctx.save();
  for (const stair of floor.stairs ?? []) drawStair({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, stair, false);
  for (const column of floor.columns ?? []) drawColumn({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, column, false);
  drawPersistedMeasurements({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, get(projectSettings));
  ctx.restore();
  drawAnnotations({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, get(projectSettings));
  drawTextAnnotations({ ctx, width: pad * 2, height: pad * 2, zoom: 1, camX: minX, camY: minY }, floor, null, null);

  // Embed rendered plan into PDF
  const imgData = offscreen.toDataURL('image/png');
  const drawAreaW = pw - margin * 2 - 4;
  const drawAreaH = ph - margin * 2 - titleBlockH - 6;
  const aspect = planW / planH;
  let imgW = drawAreaW;
  let imgH = drawAreaW / aspect;
  if (imgH > drawAreaH) { imgH = drawAreaH; imgW = drawAreaH * aspect; }
  const imgX = margin + 2 + (drawAreaW - imgW) / 2;
  const imgY = margin + 2 + (drawAreaH - imgH) / 2;
  pdf.addImage(imgData, 'PNG', imgX, imgY, imgW, imgH);

  drawTitleBlock();

  pdf.save(`${project.name || 'floorplan'}.pdf`);
  return { omitted3D: false };
}
