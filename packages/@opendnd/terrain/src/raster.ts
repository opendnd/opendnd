import type { Ring } from './path-data';
import type { DrawnMap, MapShape } from './svg-map';

/**
 * A drawing's shapes as a grid of what is where.
 *
 * Asking a shape whether it holds a point is fine for one point and hopeless
 * for a million: a coastline is thousands of segments and a world is
 * thousands of coastlines. Drawing the shapes into a grid once turns every
 * later question into a lookup, which is what both lining a drawing up
 * against its own pictures and building a world's terrain out of it need.
 *
 * Filled by scanlines, the way shapes have always been filled: for each row,
 * where the edges cross it, in order, and the spans between alternate
 * crossings are inside. Shapes are drawn in the order the drawing gives, so a
 * lake drawn over a continent is water and an island drawn in the lake is
 * land again.
 */

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** One byte a cell: 1 for land, 0 for anything else. */
  readonly land: Uint8Array;
  /** The part of the drawing this covers. */
  readonly box: Box;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface RasterOptions {
  readonly width: number;
  readonly height?: number;
  /** The part of the drawing to cover. The whole of it by default. */
  readonly box?: Box;
}

export function rasterize(map: DrawnMap, options: RasterOptions): Raster {
  const box = options.box ?? {
    left: 0,
    top: 0,
    right: map.width,
    bottom: map.height,
  };
  const width = options.width;
  const height =
    options.height ??
    Math.max(
      1,
      Math.round(
        (width * (box.bottom - box.top)) / Math.max(1e-9, box.right - box.left),
      ),
    );
  const land = new Uint8Array(width * height);
  for (const shape of map.shapes) {
    fill(land, width, height, box, shape);
  }
  return { width, height, land, box };
}

/** Whether the cell a point falls in is land. Outside the raster is not. */
export function landAt(raster: Raster, x: number, y: number): boolean {
  const { box } = raster;
  const column = Math.floor(
    ((x - box.left) / (box.right - box.left)) * raster.width,
  );
  const row = Math.floor(
    ((y - box.top) / (box.bottom - box.top)) * raster.height,
  );
  if (column < 0 || row < 0 || column >= raster.width || row >= raster.height) {
    return false;
  }
  return raster.land[row * raster.width + column] === 1;
}

/** How many of the raster's cells are land. */
export function landCells(raster: Raster): number {
  let count = 0;
  for (const cell of raster.land) count += cell;
  return count;
}

function fill(
  land: Uint8Array,
  width: number,
  height: number,
  box: Box,
  shape: MapShape,
): void {
  const value = shape.kind === 'land' ? 1 : 0;
  const scaleX = width / (box.right - box.left);
  const scaleY = height / (box.bottom - box.top);
  const [minX, minY, maxX, maxY] = shape.bounds;
  const firstRow = Math.max(0, Math.floor((minY - box.top) * scaleY));
  const lastRow = Math.min(height - 1, Math.ceil((maxY - box.top) * scaleY));
  if (lastRow < firstRow) return;
  if (maxX < box.left || minX > box.right) return;

  // Every edge of every ring, once, rather than per scanline.
  const edges: [x0: number, y0: number, x1: number, y1: number][] = [];
  for (const ring of shape.rings as readonly Ring[]) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  if (edges.length === 0) return;

  const crossings: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    // The middle of the row, in drawing units, so a shape never half-covers.
    const y = box.top + (row + 0.5) / scaleY;
    crossings.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 > y === y1 > y) continue;
      crossings.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(
        0,
        Math.ceil((crossings[i]! - box.left) * scaleX - 0.5),
      );
      const to = Math.min(
        width - 1,
        Math.floor((crossings[i + 1]! - box.left) * scaleX - 0.5),
      );
      const at = row * width;
      for (let column = from; column <= to; column += 1) {
        land[at + column] = value;
      }
    }
  }
}
