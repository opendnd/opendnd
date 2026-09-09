import { finestFor, withDetail } from './detail';
import type { Noise } from './noise';
import {
  type Outline,
  type Point,
  type Segment,
  pathDataOf,
} from './path-data';
import type { DrawnMap, MapShape } from './svg-map';

/**
 * Drawing a world's shapes as a tile.
 *
 * The point of reading a drawing rather than tracing pictures of it is that
 * the coast stays a curve. So a tile is SVG: the same béziers the coast was
 * drawn with, placed into the tile's own coordinates, smooth at any depth
 * anyone zooms to rather than as smooth as whatever grid was chosen once.
 */

export interface Palette {
  readonly sea: string;
  readonly land: string;
  readonly water: string;
  readonly coast: string;
  /** How thick a coastline is drawn, in tile pixels. */
  readonly coastWidth: number;
}

export const PALETTE: Palette = {
  sea: '#b6d1db',
  land: '#d8bc9e',
  water: '#b6d1db',
  coast: '#1c1917',
  coastWidth: 1,
};

export interface TileRequest {
  /** The part of the drawing this tile shows. */
  readonly box: { left: number; top: number; right: number; bottom: number };
  /** How many pixels across the tile is. */
  readonly size?: number;
  readonly palette?: Partial<Palette>;
  /**
   * Roughness for the depths the drawing does not reach. Below the size the
   * map was drawn at, a coast would otherwise be the smooth curve somebody
   * drew; given this, it keeps being a coast all the way down.
   */
  readonly detail?: Noise;
  /** The finest the drawing itself goes, in drawing units. Below it, detail. */
  readonly drawnTo?: number;
}

/**
 * One tile as an SVG document.
 *
 * Shapes outside the tile are left out, and shapes that cross its edge are
 * drawn whole and clipped, because a coast cut at a tile edge and a coast
 * that ends at a tile edge look different and only one of them is right.
 */
export function drawTile(map: DrawnMap, request: TileRequest): string {
  const size = request.size ?? 256;
  const palette = { ...PALETTE, ...request.palette };
  const { box } = request;
  const scale = size / (box.right - box.left);
  const place = (point: Point): Point => [
    (point[0] - box.left) * scale,
    (point[1] - box.top) * (size / (box.bottom - box.top)),
  ];

  // A little beyond the tile, so a coastline's own thickness never leaves a
  // seam along the edge where the next tile begins.
  const margin = (box.right - box.left) * 0.02;
  // A shape smaller than a pixel or two is a smudge, and drawing five hundred
  // of them into one tile costs more than the whole rest of the map.
  const tiny = ((box.right - box.left) / size) * 1.5;
  const shown = map.shapes.filter(
    (shape) => overlaps(shape, box, margin) && bigEnough(shape, tiny),
  );

  // A pixel's worth of the drawing at this zoom. Nothing finer is worth
  // making, and nothing coarser looks like a coast.
  const finest = finestFor(box, size);
  const deeper =
    request.detail !== undefined && finest < (request.drawnTo ?? 6);

  const parts: string[] = [
    `<rect width="${size}" height="${size}" fill="${palette.sea}"/>`,
  ];
  for (const shape of shown) {
    const outlines = deeper
      ? shape.outlines.map((outline) =>
          withDetail(outline, request.detail!, finest),
        )
      : shape.outlines;
    // Points closer together than half a pixel cannot be told apart once
    // drawn, and a coastline has thousands of them.
    const d = pathDataOf(
      outlines.map((outline) => thinned(outline, finest / 3)),
      place,
    );
    if (d === '') continue;
    const fill = shape.kind === 'land' ? palette.land : palette.water;
    parts.push(
      `<path d="${d}" fill="${fill}" fill-rule="evenodd" ` +
        `stroke="${palette.coast}" stroke-width="${palette.coastWidth}" ` +
        `stroke-linejoin="round"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">` +
    `<g clip-path="url(#t)">${parts.join('')}</g>` +
    `<clipPath id="t"><rect width="${size}" height="${size}"/></clipPath>` +
    `</svg>`
  );
}

function overlaps(
  shape: MapShape,
  box: { left: number; top: number; right: number; bottom: number },
  margin: number,
): boolean {
  const [minX, minY, maxX, maxY] = shape.bounds;
  return (
    maxX >= box.left - margin &&
    minX <= box.right + margin &&
    maxY >= box.top - margin &&
    minY <= box.bottom + margin
  );
}

/** Whether a shape covers enough of the tile to be worth drawing at all. */
function bigEnough(shape: MapShape, least: number): boolean {
  const [minX, minY, maxX, maxY] = shape.bounds;
  return maxX - minX > least || maxY - minY > least;
}

/**
 * An outline with the points nobody could see taken out.
 *
 * A coast drawn for a continent has a point every few feet; a tile showing the
 * whole world has a pixel every few miles. Keeping both is the difference
 * between a tile of three kilobytes and one of three megabytes.
 */
function thinned(outline: Outline, least: number): Outline {
  if (least <= 0) return outline;
  const segments: Segment[] = [];
  let last = outline.from;
  for (let i = 0; i < outline.segments.length; i += 1) {
    const segment = outline.segments[i]!;
    const span = Math.hypot(segment.to[0] - last[0], segment.to[1] - last[1]);
    // The last one is always kept, or the outline stops short of closing.
    if (span < least && i < outline.segments.length - 1) continue;
    // A curve shorter than a few pixels is a straight line once drawn, and
    // costs three points to say so. Most of a coastline is such curves.
    segments.push(
      segment.via && span < least * 6 ? { to: segment.to } : segment,
    );
    last = segment.to;
  }
  return { from: outline.from, segments };
}
