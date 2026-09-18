/**
 * Scan stored extents against the painted drawing, and cover the ones that
 * drifted.
 *
 * Seats that are not a real country (OCR leftovers) are ignored, so a
 * region they were sitting on goes to the country that is actually there.
 *
 *   bun scripts/repair-holding.ts --scan
 *   bun scripts/repair-holding.ts --apply
 *   bun scripts/repair-holding.ts --name "Côte d'Argeant" --apply
 */
import { inflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CellId } from '@opendnd/spatial';
import {
  boxToWhole,
  claimByFill,
  coveringOf,
  divide,
  inShape,
  isPoliticalFill,
  placeGroups,
  readDrawnMap,
  toDrawing,
  toLatLng,
  wholeDrawing,
  type MapShape,
  type Matrix,
  type Point,
} from '@opendnd/terrain';

const NAME = flag('name');
const APPLY = process.argv.includes('--apply');
const SCAN = process.argv.includes('--scan') || !APPLY;
const WORLD = 'de086bd0-3ad5-4650-b7c5-24398221be39';
const API = 'http://localhost:4080';
const SVG =
  '/Users/drewrymorris/Dev/opendnd-workspace/kur-ao/sources/maps/Kur-Ao-Figma.svg';
const PLACING =
  '/Users/drewrymorris/Dev/opendnd-workspace/kur-ao/trace/placing.json';
const TILES = join(process.cwd(), '.assets', 'worlds', WORLD, 'tiles');
const PAINT_ZOOM = 7;
const COLOR_TOL = 2800;
const auth = { Authorization: 'Bearer dev:Drew' };
const tileCache = new Map<string, { width: number; rgba: Uint8Array }>();

function isRealCountry(name: unknown): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (/[<>/]/.test(name)) return false;
  return !['fell', 'veooil'].includes(name.trim().toLowerCase());
}

function flag(key: string): string | undefined {
  const at = process.argv.indexOf(`--${key}`);
  if (at < 0) return undefined;
  return process.argv[at + 1];
}

interface Place {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly cell?: string;
  readonly extent?: string[];
  readonly meta?: { readonly versionId?: string };
}

const placing = (await Bun.file(PLACING).json()) as {
  groups: Record<
    string,
    { left: number; top: number; width: number; height: number }
  >;
};
const read = readDrawnMap(await Bun.file(SVG).text());
const drawing = placeGroups(
  read,
  Object.fromEntries(
    Object.entries(placing.groups).map(([group, box]) => [
      group,
      boxToWhole(box, read.width, read.height) as Matrix,
    ]),
  ),
);
const fit = wholeDrawing(drawing.width, drawing.height);
const political = drawing.shapes.filter(
  (shape) => shape.kind === 'land' && isPoliticalFill(shape.fill),
);

const places = await listPlaces();
const kingdoms = places.filter((place) => place.type === 'kingdom');
const byId = new Map(kingdoms.map((place) => [place.id, place]));

function pointOf(token: unknown): Point | undefined {
  if (typeof token !== 'string') return undefined;
  try {
    return toDrawing(fit, CellId.fromToken(token).centerLatLng());
  } catch {
    return undefined;
  }
}

const seats: { key: string; at: Point }[] = [];
for (const place of kingdoms) {
  if (!isRealCountry(place.name)) continue;
  const at = pointOf(place.cell);
  if (!at) continue;
  if (!political.some((shape) => inShape(shape, at))) continue;
  seats.push({ key: place.id, at });
}

const result = claimByFill(drawing.shapes, seats);
const claimed = new Map(result.claimed);
const shared: { shape: MapShape; keys: string[] }[] = [];
for (const contest of result.contested) {
  const keys = contest.keys.filter((key) =>
    isRealCountry(byId.get(key)?.name),
  );
  if (keys.length === 1) {
    const held = claimed.get(keys[0]!) ?? [];
    held.push(contest.shape);
    claimed.set(keys[0]!, held);
    continue;
  }
  shared.push({ shape: contest.shape, keys });
}

function nameOf(key: string): string {
  return String(byId.get(key)?.name ?? key);
}

console.log(
  `kingdoms ${kingdoms.length}; seated ${seats.length}; exclusive ${claimed.size}; shared ${shared.length}`,
);

console.log('\nshared paint (one region, several seats):');
for (const row of shared) {
  console.log(
    `  ${row.keys.map(nameOf).join(' | ')}  fill ${String(row.shape.fill)} area ${Math.round(row.shape.area)}`,
  );
}

function inBox(at: Point, bounds: MapShape['bounds']): boolean {
  return (
    at[0] >= bounds[0] &&
    at[0] <= bounds[2] &&
    at[1] >= bounds[1] &&
    at[1] <= bounds[3]
  );
}

function paintedArea(shapes: readonly MapShape[]): number {
  return shapes.reduce((sum, shape) => sum + shape.area, 0);
}

/**
 * Exclusive countries that never put a cell on one of their painted
 * paths — leftover from an old contest, not a missing covering.
 */
const dirty: string[] = [];
console.log('\nexclusive paint:');
const exclusive = [...claimed.entries()].sort(
  (a, b) => paintedArea(b[1]) - paintedArea(a[1]),
);
for (const [id, shapes] of exclusive) {
  const place = byId.get(id);
  const pts: Point[] = [];
  for (const token of place?.extent ?? []) {
    const at = pointOf(token);
    if (at) pts.push(at);
  }
  const missed = shapes.filter((shape) => {
    if (shape.area < 200) return false;
    return !pts.some((at) => inBox(at, shape.bounds) && inShape(shape, at));
  });
  const held = place?.extent?.length ?? 0;
  const area = Math.round(paintedArea(shapes));
  const short = held === 0 || missed.length > 0;
  if (short) dirty.push(id);
  if (short || (SCAN && missed.length > 0)) {
    console.log(
      `  ${short ? 'MISS' : 'ok  '}  ${String(place?.name)}  ${held} cells  area ${area}  ${shapes.length} paths  uncovered ${missed.length}`,
    );
  }
}

if (NAME) {
  const needle = NAME.toLowerCase();
  const target = kingdoms.find(
    (place) => String(place.name).toLowerCase() === needle,
  );
  if (!target) throw new Error(`no kingdom named ${NAME}`);
  const contest = shared.filter((row) =>
    row.keys.some((key) => key === target.id),
  );
  if (contest.length > 0) {
    await carveByPicture(target);
  } else {
    await repairExclusive([target.id]);
  }
} else if (APPLY) {
  await repairExclusive(dirty);
  await emptyJunk();
} else if (SCAN) {
  console.log(
    `\nscan only; ${dirty.length} exclusive with uncovered paths, ${shared.filter((row) => row.keys.length === 2).length} two-seat regions. pass --apply or --name`,
  );
}

/**
 * Cover a country from the painted pictures: flood from the seat through
 * matching pixels, then punch that region out of every neighbour. SVG fills
 * merge countries that the PNG still splits; cell-centre stealing also
 * misses, because a coarse neighbour cell is decided by a yellow middle.
 */
async function carveByPicture(target: Place): Promise<void> {
  const own = colorOfSeat(target);
  if (!own) throw new Error(`no paint under ${target.name}`);
  const seat = CellId.fromToken(target.cell!).centerLatLng();
  const rival = kingdoms.find(
    (place) => String(place.name).toLowerCase() === 'shadowfell',
  );
  const rivalAt = rival?.cell
    ? CellId.fromToken(rival.cell).centerLatLng()
    : undefined;
  const box = { south: 62.15, north: 63.85, west: -83.2, east: -72.5 };
  const extra = colorAt(62.8, -78.35);
  const fills = extra ? [own, extra] : [own];
  const flood = floodPaint(seat, fills, box, rivalAt);
  const tokens = coverFlood(flood);
  const overlap = overlapOf(tokens);
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const key of flood) {
    const [gx, gy] = key.split(',').map(Number) as [number, number];
    const at = pixelLatLng(gx, gy);
    if (at.lat < minLat) minLat = at.lat;
    if (at.lat > maxLat) maxLat = at.lat;
    if (at.lng < minLng) minLng = at.lng;
    if (at.lng > maxLng) maxLng = at.lng;
  }
  console.log(
    `\n${target.name} paint ${hexOf(own)}; flood ${flood.size} px  ${minLat.toFixed(2)}–${maxLat.toFixed(2)}N  ${minLng.toFixed(2)}–${maxLng.toFixed(2)}E  → ${tokens.length} cells`,
  );
  if (APPLY) await patch(target, { extent: tokens });
  for (const other of kingdoms) {
    if (other.id === target.id) continue;
    const extent = other.extent ?? [];
    if (extent.length === 0) continue;
    const kept = extent.flatMap((token) => punchOverlap(token, overlap, box));
    if (kept.length === extent.length) continue;
    console.log(`    punch ${other.name}: ${extent.length} → ${kept.length}`);
    if (APPLY) await patch(other, { extent: kept });
  }
}

function floodPaint(
  seat: { lat: number; lng: number },
  fills: readonly (readonly [number, number, number])[],
  box: { south: number; north: number; west: number; east: number },
  rival?: { lat: number; lng: number },
): Set<string> {
  const start = mercatorTile(seat.lat, seat.lng, PAINT_ZOOM);
  const q: [number, number][] = [
    [Math.floor(start.x * 256), Math.floor(start.y * 256)],
  ];
  const seen = new Set<string>();
  const flood = new Set<string>();
  while (q.length > 0) {
    const [gx, gy] = q.pop()!;
    const key = `${gx},${gy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = pixelLatLng(gx, gy);
    if (
      at.lat < box.south ||
      at.lat > box.north ||
      at.lng < box.west ||
      at.lng > box.east
    ) {
      continue;
    }
    if (rival && closer(at, rival, seat)) continue;
    const rgb = colorAt(at.lat, at.lng);
    if (
      !rgb ||
      !isFill(rgb) ||
      !fills.some((fill) => dist(rgb, fill) <= COLOR_TOL)
    ) {
      continue;
    }
    flood.add(key);
    q.push([gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]);
  }
  return flood;
}

function coverFlood(flood: Set<string>): string[] {
  const tokens = new Set<string>();
  for (const key of flood) {
    const [gx, gy] = key.split(',').map(Number) as [number, number];
    const at = pixelLatLng(gx, gy);
    tokens.add(CellId.fromLatLng(at, 13).token());
  }
  return [...tokens];
}

function overlapOf(tokens: readonly string[]): Set<string> {
  const overlap = new Set<string>();
  for (const token of tokens) {
    let cell = CellId.fromToken(token);
    overlap.add(cell.token());
    while (cell.level() > 6) {
      cell = cell.parent();
      overlap.add(cell.token());
    }
  }
  return overlap;
}

function hitsOverlap(cell: CellId, overlap: Set<string>): boolean {
  if (overlap.has(cell.token())) return true;
  if (cell.level() < 6) {
    return cell.children().some((child) => hitsOverlap(child, overlap));
  }
  if (cell.level() > 13) {
    try {
      return overlap.has(cell.parent(13).token());
    } catch {
      return false;
    }
  }
  return false;
}

function punchOverlap(
  token: string,
  overlap: Set<string>,
  box: { south: number; north: number; west: number; east: number },
): string[] {
  let cell: CellId;
  try {
    cell = CellId.fromToken(token);
  } catch {
    return [token];
  }
  const at = cell.centerLatLng();
  if (Math.abs(at.lat - 63) > 8 || Math.abs(at.lng + 78) > 16) {
    return [token];
  }
  if (!hitsOverlap(cell, overlap)) return [token];
  if (cell.level() >= 13) return [];
  return cell.children().flatMap((child) =>
    punchOverlap(child.token(), overlap, box),
  );
}

function pixelLatLng(gx: number, gy: number): { lat: number; lng: number } {
  const n = 2 ** PAINT_ZOOM * 256;
  const lng = (gx / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI;
  return { lat, lng };
}

function closer(
  at: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): boolean {
  const da = (at.lat - a.lat) ** 2 + (at.lng - a.lng) ** 2;
  const db = (at.lat - b.lat) ** 2 + (at.lng - b.lng) ** 2;
  return da < db;
}

function hexOf(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function dist(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function colorOfSeat(
  place: Place,
): readonly [number, number, number] | undefined {
  if (!place.cell) return undefined;
  const at = CellId.fromToken(place.cell).centerLatLng();
  return sampleAround(at.lat, at.lng);
}

function nearSeat(
  token: string,
  box: { south: number; north: number; west: number; east: number },
): boolean {
  try {
    const at = CellId.fromToken(token).centerLatLng();
    return (
      at.lat >= box.south &&
      at.lat <= box.north &&
      at.lng >= box.west &&
      at.lng <= box.east
    );
  } catch {
    return false;
  }
}

function colorOfToken(
  token: string,
): readonly [number, number, number] | undefined {
  try {
    const at = CellId.fromToken(token).centerLatLng();
    return colorAt(at.lat, at.lng);
  } catch {
    return undefined;
  }
}

function sampleAround(
  lat: number,
  lng: number,
): readonly [number, number, number] | undefined {
  const steps = [0, 0.04, 0.1, 0.2];
  const dirs: [number, number][] = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const step of steps) {
    for (const [n, e] of dirs) {
      if (step === 0 && (n !== 0 || e !== 0)) continue;
      const rgb = colorAt(lat + n * step, lng + e * step);
      if (rgb && isFill(rgb)) return rgb;
    }
  }
  return undefined;
}

function isFill(rgb: readonly [number, number, number]): boolean {
  const [r, g, b] = rgb;
  const light = (r + g + b) / 3;
  if (light < 45 || light > 242) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.08) return false;
  if (light > 232 && sat < 0.12) return false;
  if (b >= g && g > r && Math.abs(r - 182) < 30 && Math.abs(b - 219) < 30) {
    return false;
  }
  return true;
}

function mercatorTile(
  lat: number,
  lng: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function colorAt(
  lat: number,
  lng: number,
): readonly [number, number, number] | undefined {
  const { x, y } = mercatorTile(lat, lng, PAINT_ZOOM);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const key = `${PAINT_ZOOM}/${tx}/${ty}`;
  let tile = tileCache.get(key);
  if (!tile) {
    const path = join(TILES, `${PAINT_ZOOM}/${tx}/${ty}.png`);
    if (!existsSync(path)) return undefined;
    tile = decodePng(readFileSync(path));
    tileCache.set(key, tile);
  }
  const px = Math.min(tile.width - 1, Math.max(0, Math.floor((x - tx) * tile.width)));
  const py = Math.min(
    tile.width - 1,
    Math.max(0, Math.floor((y - ty) * tile.width)),
  );
  const i = (py * tile.width + px) * 4;
  return [tile.rgba[i]!, tile.rgba[i + 1]!, tile.rgba[i + 2]!];
}

function decodePng(buf: Buffer): { width: number; rgba: Uint8Array } {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not png');
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  const parts: Buffer[] = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('ascii');
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      color = data[9]!;
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    i += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6)) {
    throw new Error(`png ${depth}/${color}`);
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let src = 0;
  let prev = new Uint8Array(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[src++]!;
    const line = raw.subarray(src, src + stride);
    src += stride;
    const recon = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? recon[x - bpp]! : 0;
      const up = prev[x]!;
      const upLeft = x >= bpp ? prev[x - bpp]! : 0;
      const v = line[x]!;
      if (filter === 0) recon[x] = v;
      else if (filter === 1) recon[x] = (v + left) & 255;
      else if (filter === 2) recon[x] = (v + up) & 255;
      else if (filter === 3) recon[x] = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        recon[x] = (v + pred) & 255;
      } else {
        throw new Error(`filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const o = (row * width + x) * 4;
      const p = x * bpp;
      rgba[o] = recon[p]!;
      rgba[o + 1] = recon[p + 1]!;
      rgba[o + 2] = recon[p + 2]!;
      rgba[o + 3] = bpp === 4 ? recon[p + 3]! : 255;
    }
    prev = recon;
  }
  return { width, rgba };
}

async function repairExclusive(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    console.log('\nno exclusive paint to cover');
    return;
  }
  console.log(`\ncovering ${ids.length} exclusive ${ids.length === 1 ? 'country' : 'countries'}`);
  for (const id of ids) {
    const place = byId.get(id);
    const shapes = claimed.get(id) ?? [];
    if (!place || shapes.length === 0) continue;
    process.stderr.write(`covering ${place.name} (${shapes.length} paths)\n`);
    const tokens = [
      ...new Set(
        shapes.flatMap((shape) =>
          coveringOf(shape, fit, { minLevel: 8, maxLevel: 13, most: 80_000 }),
        ),
      ),
    ];
    console.log(
      `  ${place.name}: ${place.extent?.length ?? 0} → ${tokens.length} cells`,
    );
    if (!APPLY) continue;
    await patch(place, { extent: tokens });
    for (const other of kingdoms) {
      if (other.id === id) continue;
      const extent = other.extent ?? [];
      const kept = extent.filter((token) => {
        const at = pointOf(token);
        if (!at) return true;
        return !shapes.some(
          (shape) => inBox(at, shape.bounds) && inShape(shape, at),
        );
      });
      if (kept.length === extent.length) continue;
      console.log(
        `    strip ${other.name}: ${extent.length} → ${kept.length}`,
      );
      await patch(other, { extent: kept });
    }
  }
}

async function repairShared(
  rows: readonly { shape: MapShape; keys: string[] }[],
): Promise<void> {
  if (rows.length === 0) return;
  console.log(`\ndividing ${rows.length} two-seat painted ${rows.length === 1 ? 'region' : 'regions'}`);
  for (const row of rows) {
    const group = seats.filter((seat) => row.keys.includes(seat.key));
    const names = row.keys.map(nameOf);
    console.log(`  ${names.join(' | ')}`);
    if (!APPLY) continue;
    const cells = coveringOf(row.shape, fit, {
      minLevel: 8,
      maxLevel: 13,
      most: 80_000,
    });
    const split = divide(
      cells,
      group.map((seat) => ({ key: seat.key, at: toLatLng(fit, seat.at) })),
      { maxLevel: 13 },
    );
    for (const [key, tokens] of Object.entries(split)) {
      const place = byId.get(key);
      if (!place) continue;
      const kept = (place.extent ?? []).filter((token) => {
        const at = pointOf(token);
        if (!at) return true;
        return !inBox(at, row.shape.bounds) || !inShape(row.shape, at);
      });
      const next = [...new Set([...kept, ...tokens])];
      console.log(`    ${place.name}: ${place.extent?.length ?? 0} → ${next.length}`);
      await patch(place, { extent: next });
    }
  }
}

async function emptyJunk(): Promise<void> {
  for (const place of kingdoms) {
    if (isRealCountry(place.name)) continue;
    if (!place.extent || place.extent.length === 0) continue;
    console.log(`emptying ${place.name}`);
    await patch(place, { extent: [] });
  }
}

async function patch(place: Place, body: { extent: string[] }): Promise<void> {
  const fresh = (await (
    await fetch(`${API}/v1/worlds/${WORLD}/place/${place.id}`, { headers: auth })
  ).json()) as Place;
  const revision = fresh.meta?.versionId;
  const res = await fetch(`${API}/v1/worlds/${WORLD}/place/${place.id}`, {
    method: 'PATCH',
    headers: {
      ...auth,
      'content-type': 'application/json',
      ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH ${place.name} ${res.status} ${await res.text()}`);
  }
  (place as { extent?: string[] }).extent = body.extent;
}

async function listPlaces(): Promise<Place[]> {
  const resources: Place[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: '500' });
    if (cursor) query.set('cursor', cursor);
    const page = (await (
      await fetch(`${API}/v1/worlds/${WORLD}/place?${query}`, { headers: auth })
    ).json()) as { resources: Place[]; next?: string };
    resources.push(...page.resources);
    cursor = page.next;
  } while (cursor !== undefined);
  return resources;
}
