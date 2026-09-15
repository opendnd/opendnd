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
 * The budget is the world's, and it is spent along the world's edges in
 * proportion to their length, because that is the only division under which
 * every border comes back at the same grain. Given to each country alike, a
 * country holding a tenth of the land is traced at cells hundreds of miles
 * across while an island the size of a town is traced to a tenth of a mile:
 * a covering that runs out of budget stops splitting and hands each
 * remaining cell whole to whichever side holds its middle, so a starved
 * country is a staircase and a rich one is a coastline. A level costs about
 * twice the cells, since they are spent along a line, so the world's budget
 * sets the grain: about three cells per unit of the drawing is level twelve,
 * which is finer than the artwork's own pixel.
 */
const EDGE_LEVEL = Number(flag('edge-level') ?? 13);
const EDGE_BUDGET = Number(flag('edge-budget') ?? 600_000);

/**
 * The fewest cells a path is covered with, however little of the world's
 * edge it is: enough that an islet is an islet rather than a square.
 */
const EDGE_FLOOR = 48;

/** How far it is round a shape, in the drawing's own units. */
function edgeLength(shape: MapShape): number {
  let length = 0;
  for (const ring of shape.rings) {
    for (let at = 0; at < ring.length; at++) {
      const from = ring[at]!;
      const to = ring[(at + 1) % ring.length]!;
      length += Math.hypot(to[0] - from[0], to[1] - from[1]);
    }
  }
  return length;
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

/*
 * Every path the world will be covered from, so that the budget can be
 * divided before any of it is spent. A contested path counts once here,
 * however many countries it is about to be split between: it is one edge on
 * the drawing, and the boundaries inside it are drawn by the division, which
 * refines what it is given.
 */
const covering: MapShape[] = [
  ...places.flatMap((place) => claimedShapes.get(place.id) ?? []),
  ...result.contested.map((contest) => contest.shape),
];
const world = covering.reduce((sum, shape) => sum + edgeLength(shape), 0);
console.log(
  `edge to follow ${Math.round(world)} drawing units over ${covering.length} paths; budget ${EDGE_BUDGET} cells`,
);

/** A path's share of the world's budget, by how much of its edge it is. */
function budgetOf(shape: MapShape): {
  maxLevel: number;
  minLevel: number;
  most: number;
} {
  return {
    maxLevel: EDGE_LEVEL,
    // Inland squares coarser than this become the staircase countries:
    // Veria is stored as a level-3 cell, and that cell is what the map
    // draws. Eight is still cheap on the inside and fine enough that a
    // neighbour is not a right angle.
    minLevel: 8,
    most:
      world > 0
        ? Math.max(
            EDGE_FLOOR,
            Math.round((EDGE_BUDGET * edgeLength(shape)) / world),
          )
        : EDGE_FLOOR,
  };
}

for (const place of places) {
  const shapes = claimedShapes.get(place.id);
  if (!shapes || shapes.length === 0) continue;
  process.stderr.write(
    `covering ${place.name ?? place.id} (${shapes.length} paths)\n`,
  );
  addTokens(
    place.id,
    shapes.flatMap((shape) => coveringOf(shape, fit, budgetOf(shape))),
  );
}

/*
 * A painted region with several countries on it is one country as far as the
 * artwork goes: the boundaries between them are this script's invention, and
 * a nearest-seat division draws them straight, which is what a map of
 * treaties looks like and not what a map of coastlines looks like. So they
 * are named as they are drawn — anybody looking at a suspiciously straight
 * border on the map can find it here — and the cure is in the drawing, by
 * painting the countries apart, rather than in the division.
 */
for (const contest of result.contested) {
  const group = seats.filter((seat) => contest.keys.includes(seat.key));
  if (group.length === 0) continue;
  const names = group.map(
    (seat) => places.find((place) => place.id === seat.key)?.name ?? seat.key,
  );
  console.log(
    `  dividing one painted region between ${group.length}: ${names.join(', ')}`,
  );
  const cells = coveringOf(contest.shape, fit, budgetOf(contest.shape));
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
  const own = pointOfCell(place.cell, fit);
  if (own) {
    const seat = seatFrom([place.cell as string], fit, political, own);
    if (seat) return seat;
  }
  return (
    seatFrom(place.extent ?? [], fit, political, own) ??
    nearby(place, fit, political)
  );
}

/**
 * The painted shape most of these cells sit on, and a point on it.
 *
 * Which shape is a vote, and the point within it is the sampled cell nearest
 * to where the place itself was put. The point matters as much as the shape:
 * a painted region with several countries on it is divided between their
 * seats, so a seat that wanders from one run to the next moves a border that
 * nothing in the world moved. Taking the first sample that landed on the
 * winning shape makes the seat a function of which cells a previous run
 * happened to hand out and how finely; taking the one nearest the place's own
 * dot makes it a function of the drawing and the dot, which is what a reader
 * of the map would say the country's middle was anyway.
 */
function seatFrom(
  tokens: readonly string[],
  fit: ReturnType<typeof wholeDrawing>,
  political: readonly MapShape[],
  toward?: Point,
): Point | undefined {
  const step = tokens.length <= 400 ? 1 : Math.ceil(tokens.length / 400);
  const votes = new Map<MapShape, { n: number; at: Point; away: number }>();
  for (let i = 0; i < tokens.length; i += step) {
    let latlng: LatLng;
    try {
      latlng = CellId.fromToken(tokens[i]!).centerLatLng();
    } catch {
      continue;
    }
    const at = toDrawing(fit, latlng);
    const hit = political.find((shape) => inShape(shape, at));
    if (!hit) continue;
    const away = toward ? Math.hypot(at[0] - toward[0], at[1] - toward[1]) : i;
    const had = votes.get(hit);
    if (!had) {
      votes.set(hit, { n: 1, at, away });
      continue;
    }
    had.n += 1;
    if (away < had.away) {
      had.at = at;
      had.away = away;
    }
  }
  let best: { n: number; at: Point } | undefined;
  for (const vote of votes.values()) {
    if (best === undefined || vote.n > best.n) best = vote;
  }
  return best?.at;
}

/** Where a place's own cell is in the drawing, if it names one. */
function pointOfCell(
  token: unknown,
  fit: ReturnType<typeof wholeDrawing>,
): Point | undefined {
  if (typeof token !== 'string') return undefined;
  try {
    return toDrawing(fit, CellId.fromToken(token).centerLatLng());
  } catch {
    return undefined;
  }
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
