import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import type { AssetStore, StoredAsset } from './assets';

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
  /** Digest of the coastline file, and therefore of every tile drawn from it. */
  readonly revision: string;
  /** Store identity used to notice a replacement in another process. */
  readonly sourceVersion: string;
}

/**
 * Worlds whose shapes have been read, kept for as long as the process lives.
 *
 * Reading a world of coastlines takes long enough that doing it per tile would
 * be the whole cost of a map. A world's shapes change when somebody redraws
 * them. A cheap store version check keeps warm API processes coherent with
 * direct S3 writes; `forget` remains useful when this process made the write.
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
  const key = terrainKey(world);
  const sourceVersion = await assets.version(key);
  const held = ready.get(world);
  if (held && held.sourceVersion === sourceVersion) return held;
  if (sourceVersion === undefined) {
    ready.delete(world);
    return undefined;
  }

  const stored = await assets.get(key);
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
    revision: createHash('sha256').update(stored.body).digest('hex'),
    sourceVersion,
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
  return draw(found, z, x, y);
}

/** Where one PNG rendering of a particular coastline revision is cached. */
export function terrainTileKey(
  world: string,
  revision: string,
  z: number,
  x: number,
  y: number,
): string {
  const across = 2 ** z;
  const column = ((x % across) + across) % across;
  return `worlds/${world}/terrain-tiles/${revision}/${z}/${column}/${y}.png`;
}

/**
 * A PNG texture for MapLibre, drawn from the current terrain and cached.
 *
 * The revision is part of the internal key, so a changed coastline can never
 * pick up a picture rendered from the previous terrain. Concurrent misses may
 * render the same deterministic bytes twice; either write wins.
 */
export async function renderPngTile(
  assets: AssetStore,
  world: string,
  z: number,
  x: number,
  y: number,
): Promise<StoredAsset | undefined> {
  const found = await terrainOf(assets, world);
  if (!found) return undefined;
  return renderPng(assets, world, found, z, x, y);
}

async function renderPng(
  assets: AssetStore,
  world: string,
  found: Ready,
  z: number,
  x: number,
  y: number,
): Promise<StoredAsset | undefined> {
  const svg = draw(found, z, x, y);
  if (svg === undefined) return undefined;
  const key = terrainTileKey(world, found.revision, z, x, y);
  const cached = await assets.get(key);
  if (cached) return cached;
  const body = await rasterize(svg);
  await assets.put(key, body, 'image/png');
  return { key, body, contentType: 'image/png', size: body.byteLength };
}

/** Fill the inexpensive globe levels after a coastline file changes. */
export async function prewarmTerrain(
  assets: AssetStore,
  world: string,
  through = 4,
): Promise<number> {
  forget(world);
  const found = await terrainOf(assets, world);
  if (!found) return 0;
  let rendered = 0;
  for (let z = 0; z <= through; z++) {
    const across = 2 ** z;
    for (let y = 0; y < across; y++) {
      for (let x = 0; x < across; x++) {
        if (await renderPng(assets, world, found, z, x, y)) rendered++;
      }
    }
  }
  return rendered;
}

function draw(
  found: Ready,
  z: number,
  x: number,
  y: number,
): string | undefined {
  const { map, noise, drawnTo } = found;
  const across = 2 ** z;
  if (y < 0 || y >= across) return undefined;
  // East of the last column is the first column again. A world is round: sail
  // west from one coast and you arrive at the other, and a map that stopped
  // at the edge of its drawing would be saying otherwise. It is also what
  // lets a map zoomed out fill a wide window with world instead of nothing.
  const column = ((x % across) + across) % across;
  const wide = map.width / across;
  const tall = map.height / across;
  return drawTile(map, {
    box: {
      left: column * wide,
      top: y * tall,
      right: (column + 1) * wide,
      bottom: (y + 1) * tall,
    },
    size: 256,
    detail: noise,
    drawnTo,
  });
}

const moduleRequire = createRequire(__filename);
let wasmReady: Promise<void> | undefined;

async function rasterize(svg: string): Promise<Uint8Array> {
  wasmReady ??= readFile(
    moduleRequire.resolve('@resvg/resvg-wasm/index_bg.wasm'),
  ).then((wasm) => initWasm(wasm));
  await wasmReady;
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    return renderer.render().asPng();
  } finally {
    renderer.free();
  }
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
