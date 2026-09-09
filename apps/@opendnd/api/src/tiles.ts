import {
  type DrawnMap,
  type MapShape,
  Noise,
  boundsOf,
  drawTile,
  flatten,
  outlinesOf,
  signedArea,
  wholeDrawing,
} from '@opendnd/terrain';
import type { AssetStore } from './assets';

/**
 * A world's map, drawn rather than stored.
 *
 * A pyramid of pictures is a map somebody made once, at the sizes they thought
 * of. Drawing each tile as it is asked for costs a few milliseconds and gives
 * a map that is right at every size, that changes the moment the world does,
 * and that has no twenty thousand files behind it.
 *
 * What it draws from is one file per world, under a well-known key, holding
 * the world's coastlines as the curves they were drawn with. That file is
 * written from a drawing somebody made, or by the generator for a world nobody
 * has drawn — and nothing here can tell which.
 */

/** Where a world's shapes live. One file, not one per tile. */
export function terrainKey(world: string): string {
  return `worlds/${world}/terrain.json`;
}

/** The file's shape: the drawing's extent, and its shapes as path data. */
export interface TerrainFile {
  readonly width: number;
  readonly height: number;
  /** A word to seed the roughness below the depth the shapes were drawn at. */
  readonly seed?: string;
  /** The finest the shapes themselves go, in their own units. */
  readonly drawnTo?: number;
  readonly shapes: readonly {
    readonly group?: string;
    readonly kind: 'land' | 'water';
    readonly d: string;
  }[];
}

interface Ready {
  readonly map: DrawnMap;
  readonly noise: Noise;
  readonly drawnTo: number;
}

/**
 * Worlds whose shapes have been read, kept for as long as the process lives.
 *
 * Reading a world of coastlines takes long enough that doing it per tile would
 * be the whole cost of a map. A world's shapes change when somebody redraws
 * them, which is rare and goes through `forget`.
 */
const ready = new Map<string, Ready>();

export function forget(world: string): void {
  ready.delete(world);
}

/** The shapes of a world, or nothing when it has none to draw from. */
export async function terrainOf(
  assets: AssetStore,
  world: string,
): Promise<Ready | undefined> {
  const held = ready.get(world);
  if (held) return held;

  const stored = await assets.get(terrainKey(world));
  if (!stored) return undefined;
  let file: TerrainFile;
  try {
    file = JSON.parse(new TextDecoder().decode(stored.body)) as TerrainFile;
  } catch {
    return undefined;
  }
  if (!Array.isArray(file.shapes) || file.shapes.length === 0) return undefined;

  const shapes: MapShape[] = [];
  for (const one of file.shapes) {
    const outlines = outlinesOf(one.d);
    if (outlines.length === 0) continue;
    const rings = outlines.map((outline) => flatten(outline));
    shapes.push({
      group: one.group ?? '',
      kind: one.kind,
      rings,
      outlines,
      bounds: boundsOf(rings),
      area: rings.reduce(
        (sum, ring) => sum + Math.abs(signedArea(ring)) / 2,
        0,
      ),
    });
  }
  const made: Ready = {
    map: { width: file.width, height: file.height, shapes, groups: [] },
    noise: new Noise(file.seed ?? world),
    drawnTo: file.drawnTo ?? 6,
  };
  ready.set(world, made);
  return made;
}

/**
 * One tile of a world's map, as SVG.
 *
 * The tile square is the drawing square, so a tile is the part of the drawing
 * that falls in it: no projection, because a drawing made to be tiled is
 * already in the projection tiles are served in.
 */
export async function renderTile(
  assets: AssetStore,
  world: string,
  z: number,
  x: number,
  y: number,
): Promise<string | undefined> {
  const found = await terrainOf(assets, world);
  if (!found) return undefined;
  const { map, noise, drawnTo } = found;
  const across = 2 ** z;
  const wide = map.width / across;
  const tall = map.height / across;
  return drawTile(map, {
    box: {
      left: x * wide,
      top: y * tall,
      right: (x + 1) * wide,
      bottom: (y + 1) * tall,
    },
    size: 256,
    detail: noise,
    drawnTo,
  });
}

/** How deep the map can be drawn before a tile is smaller than a house. */
export function deepestZoom(): number {
  return 22;
}

/** Whether a world's own record says its map is drawn rather than stored. */
export function wantsDrawing(map: unknown): boolean {
  return (
    map !== null &&
    typeof map === 'object' &&
    (map as { source?: unknown }).source === 'terrain'
  );
}

/** A fit over the whole of a world's drawing, for anything that needs one. */
export function fitOf(file: Pick<TerrainFile, 'width' | 'height'>) {
  return wholeDrawing(file.width, file.height);
}
