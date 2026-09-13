/**
 * Cover painted countries from a local drawing into place.extent.
 *
 * The SVG stays outside git. Run against a world the caller names, dry-run
 * unless `--apply` is passed.
 *
 *   bun scripts/cover-from-drawing.ts --world <uuid> --svg <path>
 *     [--placing <path>] [--apply]
 */
import { CellId } from '@opendnd/spatial';
import {
  aPointOf,
  boxToWhole,
  claimByFill,
  coveringOf,
  divide,
  inShape,
  isPoliticalFill,
  nearestPolitical,
  placeGroups,
  readDrawnMap,
  toDrawing,
  toLatLng,
  wholeDrawing,
  type LatLng,
  type MapShape,
  type Matrix,
  type Point,
} from '@opendnd/terrain';

const WORLD = flag('world');
const SVG_PATH = flag('svg');
const PLACING_PATH = flag('placing');
const API = flag('api') ?? 'http://localhost:4080';
const USER = flag('user') ?? 'Drew';
const APPLY = process.argv.includes('--apply');
const EXPORT_TO = flag('export-to') ?? `/tmp/kur-ao-export-${Date.now()}.json`;
const REPORT_TO = flag('report-to');

if (!WORLD || !SVG_PATH) {
  console.error(
    'usage: bun scripts/cover-from-drawing.ts --world <uuid> --svg <path> [--apply]',
  );
  process.exit(1);
}

const worldId = WORLD;
const svgPath = SVG_PATH;

/**
 * How finely to follow a painted edge.
 *
 * A covering spends its cells on the border and keeps the inside whole, so
 * this is a budget for the edge rather than for the country: raising it buys
 * a closer border and costs nothing inland. The map is drawn from these
 * cells — a border is the sides of them whose far side is somebody else's —
 * so the edge wants to be finer than the drawing it came from, and no finer
 * than that, which past level twelve or thirteen it would be.
 *
 * The budget is a country's, not a path's, because the map page fetches
 * every country's cells to draw the layer at all: an archipelago of thirty
 * islands must not cost thirty times what a mainland costs.
 */
const EDGE_LEVEL = 13;
const EDGE_BUDGET = 900;

function edges(paths: number): { maxLevel: number; most: number } {
  return {
    maxLevel: EDGE_LEVEL,
    most: Math.max(150, Math.floor(EDGE_BUDGET / Math.max(1, paths))),
  };
}

interface Place {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly cell?: string;
  readonly extent?: string[];
  readonly meta?: { readonly versionId?: string };
}

const auth = { Authorization: `Bearer dev:${USER}` };

const backup = await (await get(`/v1/worlds/${worldId}/$export/json`)).text();
await Bun.write(EXPORT_TO, backup);
console.log(`export written to ${EXPORT_TO}`);

/*
 * The drawing as the map was tiled from, not as it is now.
 *
 * A drawing gets edited after pictures are made from it: a continent is
 * nudged, and the pictures stay where they were. The world's tiles are drawn
 * from the drawing with each such layer placed back where the pictures show
 * it, so countries covered from the drawing unplaced would sit off their own
 * coastlines — by a few hundred drawing units, which is most of a country.
 * The placing is the same file the tiles were written with.
 */
const read = readDrawnMap(await Bun.file(svgPath).text());
const drawing = PLACING_PATH
  ? placeGroups(read, await placingsFrom(PLACING_PATH, read.width, read.height))
  : read;
const fit = wholeDrawing(drawing.width, drawing.height);
const political = drawing.shapes.filter(
  (shape) => shape.kind === 'land' && isPoliticalFill(shape.fill),
);

const places = (await listPlaces()).filter((place) => place.type === 'kingdom');
const seats: { key: string; at: Point }[] = [];
for (const place of places) {
  const at = seatOnPaint(place, fit, political);
  if (at) seats.push({ key: place.id, at });
}

const result = claimByFill(drawing.shapes, seats);
const claimedShapes = result.claimed;
const skipped = [...result.skipped];
const seated = new Set(seats.map((seat) => seat.key));
for (const place of places) {
  if (!seated.has(place.id)) {
    skipped.push({
      key: place.id,
      reason: 'no sampled cell sits on a political fill',
    });
  }
}
console.log(
  `kingdoms ${places.length}; seated ${seats.length}; claimed ${claimedShapes.size}; contested ${result.contested.length}; skipped ${skipped.length}; unclaimed paths ${result.unclaimed}`,
);
for (const skip of skipped) {
  const name = places.find((place) => place.id === skip.key)?.name ?? skip.key;
  console.log(`  skip ${name}: ${skip.reason}`);
}

const tokensByPlace = new Map<string, string[]>();
function addTokens(key: string, tokens: readonly string[]): void {
  const had = tokensByPlace.get(key) ?? [];
  for (const token of tokens) had.push(token);
  tokensByPlace.set(key, [...new Set(had)]);
}

for (const place of places) {
  const shapes = claimedShapes.get(place.id);
  if (!shapes || shapes.length === 0) continue;
  process.stderr.write(
    `covering ${place.name ?? place.id} (${shapes.length} paths)\n`,
  );
  addTokens(
    place.id,
    shapes.flatMap((shape) => coveringOf(shape, fit, edges(shapes.length))),
  );
}

for (const contest of result.contested) {
  const group = seats.filter((seat) => contest.keys.includes(seat.key));
  if (group.length === 0) continue;
  process.stderr.write(`dividing contested path among ${group.length} seats\n`);
  // Shared ground is about to be split several ways, so it is covered
  // finely enough that each side still has an edge worth drawing.
  const cells = coveringOf(contest.shape, fit, {
    maxLevel: EDGE_LEVEL,
    most: EDGE_BUDGET * group.length,
  });
  const split = divide(
    cells,
    group.map((seat) => ({ key: seat.key, at: toLatLng(fit, seat.at) })),
    { maxLevel: EDGE_LEVEL },
  );
  for (const [key, tokens] of Object.entries(split)) addTokens(key, tokens);
}

const reports: {
  name: string;
  id: string;
  paths: number;
  before: number;
  after: number;
  jaccard: number;
  tokens: string[];
}[] = [];

for (const place of places) {
  const tokens = tokensByPlace.get(place.id);
  if (!tokens || tokens.length === 0) continue;
  const before = place.extent ?? [];
  reports.push({
    name: String(place.name ?? place.id),
    id: place.id,
    paths: claimedShapes.get(place.id)?.length ?? 0,
    before: before.length,
    after: tokens.length,
    jaccard: jaccard(before, tokens),
    tokens,
  });
}

const mean =
  reports.reduce((sum, row) => sum + row.jaccard, 0) /
  Math.max(reports.length, 1);
console.log(
  `covered ${reports.length}; mean Jaccard ${mean.toFixed(3)}; median cells ${median(reports.map((r) => r.after))}`,
);
if (REPORT_TO) {
  await Bun.write(REPORT_TO, JSON.stringify(reports, undefined, 2));
  console.log(`candidate extents written to ${REPORT_TO}`);
}
for (const row of reports.sort((a, b) => a.jaccard - b.jaccard).slice(0, 15)) {
  console.log(
    `  ${row.name}: jaccard ${row.jaccard.toFixed(3)}  ${row.before} → ${row.after} cells`,
  );
}

if (!APPLY) {
  console.log('dry-run only; pass --apply to PATCH extent');
  process.exit(0);
}

let patched = 0;
let left = 0;
for (const row of reports) {
  if (row.after < 4) {
    console.log(`  skip PATCH ${row.name}: only ${row.after} cells`);
    left += 1;
    continue;
  }
  const read = (await (
    await get(`/v1/worlds/${worldId}/place/${row.id}`)
  ).json()) as Place;
  const revision = read.meta?.versionId;
  const res = await fetch(`${API}/v1/worlds/${worldId}/place/${row.id}`, {
    method: 'PATCH',
    headers: {
      ...auth,
      'content-type': 'application/json',
      ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
    },
    body: JSON.stringify({ extent: row.tokens }),
  });
  if (!res.ok) {
    console.error(
      `PATCH ${row.name} failed: ${res.status} ${await res.text()}`,
    );
    process.exit(1);
  }
  patched += 1;
}
console.log(`patched extent on ${patched} kingdoms; left ${left} tiny`);

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return undefined;
  return process.argv[at + 1];
}

async function get(path: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, { headers: auth });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }
  return res;
}

async function listPlaces(): Promise<Place[]> {
  const resources: Place[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: '500' });
    if (cursor) query.set('cursor', cursor);
    const page = (await (
      await get(`/v1/worlds/${worldId}/place?${query}`)
    ).json()) as { resources: Place[]; next?: string };
    resources.push(...page.resources);
    cursor = page.next;
  } while (cursor !== undefined);
  return resources;
}

/** Each named layer's placing, read as the box of the drawing it now fills. */
async function placingsFrom(
  path: string,
  width: number,
  height: number,
): Promise<Record<string, Matrix>> {
  const file = (await Bun.file(path).json()) as {
    groups?: Record<
      string,
      { left: number; top: number; width: number; height: number }
    >;
  };
  const groups = Object.entries(file.groups ?? {});
  console.log(
    `placing ${groups.length} layers: ${groups.map(([name]) => name).join(', ')}`,
  );
  return Object.fromEntries(
    groups.map(([group, box]) => [group, boxToWhole(box, width, height)]),
  );
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 1 : inter / union;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * A drawing-space point on this place's painted land.
 *
 * The place's own cell is asked first, and the ground it holds only if that
 * cell is not on paint. An extent is a previous run's answer; a cell is where
 * the place was put. Voting over a run's own output would let one bad answer
 * keep itself.
 */
function seatOnPaint(
  place: Place,
  fit: ReturnType<typeof wholeDrawing>,
  political: readonly MapShape[],
): Point | undefined {
  if (typeof place.cell === 'string') {
    const seat = seatFrom([place.cell], fit, political);
    if (seat) return seat;
  }
  return (
    seatFrom(place.extent ?? [], fit, political) ??
    nearby(place, fit, political)
  );
}

/** The painted shape most of these cells sit on, and a point on it. */
function seatFrom(
  tokens: readonly string[],
  fit: ReturnType<typeof wholeDrawing>,
  political: readonly MapShape[],
): Point | undefined {
  const step = tokens.length <= 400 ? 1 : Math.ceil(tokens.length / 400);
  const votes = new Map<MapShape, { n: number; at: Point }>();
  let fallback: Point | undefined;
  for (let i = 0; i < tokens.length; i += step) {
    let latlng: LatLng;
    try {
      latlng = CellId.fromToken(tokens[i]!).centerLatLng();
    } catch {
      continue;
    }
    const at = toDrawing(fit, latlng);
    fallback ??= at;
    const hit = political.find((shape) => inShape(shape, at));
    if (!hit) continue;
    const had = votes.get(hit);
    if (had) had.n += 1;
    else votes.set(hit, { n: 1, at });
  }
  let best: { n: number; at: Point } | undefined;
  for (const vote of votes.values()) {
    if (best === undefined || vote.n > best.n) best = vote;
  }
  return best?.at;
}

/**
 * The nearest painted country to where a place sits.
 *
 * For a place whose own cell is in the sea or on unpainted land: near enough
 * is better than nothing, and nothing is what a country with no seat gets.
 */
function nearby(
  place: Place,
  fit: ReturnType<typeof wholeDrawing>,
  political: readonly MapShape[],
): Point | undefined {
  const token =
    typeof place.cell === 'string' ? place.cell : (place.extent ?? [])[0];
  if (token === undefined) return undefined;
  let at: Point;
  try {
    at = toDrawing(fit, CellId.fromToken(token).centerLatLng());
  } catch {
    return undefined;
  }
  const near = nearestPolitical(political, at);
  return near === undefined ? undefined : aPointOf(near);
}
