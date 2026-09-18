import { centerOf, parseCell, type LatLng, type View } from './cells';
import type { Holding } from './ground';

/**
 * Colours sampled from the authored political pictures.
 *
 * The live layer hashes a country's id into a hue, which is a different
 * map from the one that was painted. A pixel under the seat is the colour
 * that drawing used for that country; a pixel that is water is not ground
 * and should not be filled.
 */

const TILE = 256;

/** Zoom used to read a country's painted colour and to skip the sea. */
export const PAINT_ZOOM = 6;

function near(
  r: number,
  g: number,
  b: number,
  red: number,
  green: number,
  blue: number,
  tol: number,
): boolean {
  return (
    Math.abs(r - red) <= tol &&
    Math.abs(g - green) <= tol &&
    Math.abs(b - blue) <= tol
  );
}

/** Fills that are water, ice, or unpainted ground on the authored map. */
export function isWaterColor(r: number, g: number, b: number): boolean {
  const light = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (light > 232 && sat < 0.12) return true;
  if (near(r, g, b, 235, 235, 235, 12)) return true;
  // #b6d1db — the sea, not a purple or brown country that happens to be pale.
  if (near(r, g, b, 182, 209, 219, 22) && b >= g && g > r) return true;
  return false;
}

/**
 * A pixel that is a country's fill, not the sea, the ink of a name, or paper.
 */
export function isPaintFill(r: number, g: number, b: number): boolean {
  if (isWaterColor(r, g, b)) return false;
  const light = (r + g + b) / 3;
  if (light < 45 || light > 242) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat >= 0.08;
}

export function rgbHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** The line colour for a painted fill. */
export function paintEdge(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  if (Number.isNaN(n) || hex.length < 7) return hex;
  return rgbHex(
    ((n >> 16) & 255) * 0.45,
    ((n >> 8) & 255) * 0.45,
    (n & 255) * 0.45,
  );
}

export function mercatorTile(
  lat: number,
  lng: number,
  z: number,
): { readonly x: number; readonly y: number } {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * Drop cells whose centre samples as water on the authored pictures.
 *
 * Only cells in the view are tested: the rest are not drawn, and walking
 * a country of eighty thousand cells to skip the sea would spend the frame
 * on work nobody can see.
 */
export async function dropWater<T extends Holding>(
  holdings: readonly T[],
  view: View,
  colorAt: (
    at: LatLng,
  ) => Promise<readonly [number, number, number] | undefined>,
): Promise<T[]> {
  const next: T[] = [];
  for (const holding of holdings) {
    const extent = holding.resource.extent;
    if (!Array.isArray(extent)) {
      next.push(holding);
      continue;
    }
    const kept: string[] = [];
    for (const token of extent) {
      const cell = parseCell(String(token));
      if (!cell) continue;
      const at = centerOf(cell);
      if (!inBox(at, view)) {
        kept.push(String(token));
        continue;
      }
      const rgb = await colorAt(at);
      if (rgb && isWaterColor(rgb[0], rgb[1], rgb[2])) continue;
      kept.push(String(token));
    }
    next.push({
      ...holding,
      resource: { ...holding.resource, extent: kept },
    });
  }
  return next;
}

function inBox(at: LatLng, view: View): boolean {
  if (at.lat < view.south || at.lat > view.north) return false;
  if (view.east - view.west >= 360) return true;
  let lng = at.lng;
  while (lng < view.west) lng += 360;
  return lng <= view.east;
}

const FILL_STEPS = [0, 0.06, 0.14, 0.28, 0.5];
const FILL_DIRS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Walk off a letter's ink until a country's fill is under the sampler.
 */
export async function sampleFill(
  colorAt: (
    lat: number,
    lng: number,
    z?: number,
  ) => Promise<readonly [number, number, number] | undefined>,
  lat: number,
  lng: number,
): Promise<readonly [number, number, number] | undefined> {
  for (const z of [PAINT_ZOOM, PAINT_ZOOM - 1, PAINT_ZOOM + 1]) {
    for (const step of FILL_STEPS) {
      for (const [north, east] of FILL_DIRS) {
        if (step === 0 && (north !== 0 || east !== 0)) continue;
        const rgb = await colorAt(lat + north * step, lng + east * step, z);
        if (rgb && isPaintFill(rgb[0], rgb[1], rgb[2])) return rgb;
      }
    }
  }
  return undefined;
}

/** Picture tiles, sampled one pixel at a time, cached by tile. */
export class PictureSampler {
  private readonly tiles = new Map<string, Promise<ImageData | undefined>>();

  constructor(private readonly template: string) {}

  async colorAt(
    lat: number,
    lng: number,
    z = PAINT_ZOOM,
  ): Promise<readonly [number, number, number] | undefined> {
    const { x, y } = mercatorTile(lat, lng, z);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const data = await this.tile(z, tx, ty);
    if (!data) return undefined;
    const px = Math.min(TILE - 1, Math.max(0, Math.floor((x - tx) * TILE)));
    const py = Math.min(TILE - 1, Math.max(0, Math.floor((y - ty) * TILE)));
    const i = (py * TILE + px) * 4;
    return [data.data[i]!, data.data[i + 1]!, data.data[i + 2]!];
  }

  /**
   * A country's painted fill, walking off the ink of its name if the seat
   * landed on the letters.
   */
  async fillAt(
    lat: number,
    lng: number,
  ): Promise<readonly [number, number, number] | undefined> {
    return sampleFill(
      (atLat, atLng, z) => this.colorAt(atLat, atLng, z),
      lat,
      lng,
    );
  }

  private tile(
    z: number,
    x: number,
    y: number,
  ): Promise<ImageData | undefined> {
    const key = `${z}/${x}/${y}`;
    const had = this.tiles.get(key);
    if (had) return had;
    const load = this.load(z, x, y);
    this.tiles.set(key, load);
    return load;
  }

  private async load(
    z: number,
    x: number,
    y: number,
  ): Promise<ImageData | undefined> {
    try {
      const url = this.template
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const res = await fetch(url);
      if (!res.ok) return undefined;
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = TILE;
      canvas.height = TILE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, TILE, TILE);
    } catch {
      return undefined;
    }
  }
}
