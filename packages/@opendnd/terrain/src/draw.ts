import { type Point, pathDataOf } from './path-data';
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
  const shown = map.shapes.filter((shape) => overlaps(shape, box, margin));

  const parts: string[] = [
    `<rect width="${size}" height="${size}" fill="${palette.sea}"/>`,
  ];
  for (const shape of shown) {
    const d = pathDataOf(shape.outlines, place);
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
