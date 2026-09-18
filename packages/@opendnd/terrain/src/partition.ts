import { CellId } from '@opendnd/spatial';
import type { ClaimResult, FillSeat } from './claim';
import { inShape } from './claim';
import { coveringOf, type CoveringOptions } from './covering';
import type { MapFit } from './fit';
import type { Point } from './path-data';
import type { MapShape } from './svg-map';

/**
 * One country's painted land, after contested paths have been given to a
 * single seat.
 *
 * The drawing is the source of a border, not the cells stored last time. A
 * path with two seats on it is still one country as painted: the seat
 * farthest from the edge of that path keeps the whole of it. The other seat
 * was dropped on the line.
 */
export interface LandRegion {
  readonly key: string;
  readonly shapes: readonly MapShape[];
  readonly at?: Point;
  readonly area: number;
}

/**
 * Cells already given to someone, so a later country can only keep what is
 * still free.
 *
 * S2 cells nest or they miss: there is no third way. Asking whether a cell
 * is taken is a walk to the face plus a range search for anything already
 * held inside it.
 */
export class Taken {
  private readonly tokens = new Set<string>();
  private cells: CellId[] = [];
  private sorted = false;

  get size(): number {
    return this.tokens.size;
  }

  add(token: string): void {
    if (this.tokens.has(token)) return;
    this.tokens.add(token);
    this.cells.push(CellId.fromToken(token));
    this.sorted = false;
  }

  addAll(tokens: readonly string[]): void {
    for (const token of tokens) this.add(token);
  }

  has(token: string): boolean {
    return this.tokens.has(token);
  }

  /** An ancestor of this cell — or the cell itself — is already held. */
  covered(cell: CellId): boolean {
    let at: CellId | undefined = cell;
    while (at) {
      if (this.tokens.has(at.token())) return true;
      if (at.level() === 0) break;
      at = at.parent();
    }
    return false;
  }

  /** A held cell sits inside this one. */
  containsHeld(cell: CellId): boolean {
    const cells = this.order();
    const from = cell.rangeMin();
    const to = cell.rangeMax();
    let lo = 0;
    let hi = cells.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cells[mid]!.rangeMin() < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < cells.length; i += 1) {
      const other = cells[i]!;
      if (other.rangeMin() > to) break;
      if (other.rangeMax() <= to) return true;
    }
    return false;
  }

  private order(): CellId[] {
    if (!this.sorted) {
      this.cells.sort((a, b) =>
        a.rangeMin() < b.rangeMin() ? -1 : a.rangeMin() > b.rangeMin() ? 1 : 0,
      );
      this.sorted = true;
    }
    return this.cells;
  }
}

/**
 * How far a seat sits from the bounding box of a path, or -1 if it is
 * not in the path at all.
 *
 * A label dropped on the stroke is a few drawing units from the edge. A
 * country that actually lives in the region sits much farther in.
 */
export const RIM = 32;

export function insetOf(
  shape: Pick<MapShape, 'rings' | 'bounds'>,
  point: Point | undefined,
): number {
  if (point === undefined || !inShape(shape, point)) return -1;
  const [x0, y0, x1, y1] = shape.bounds;
  return Math.min(point[0] - x0, x1 - point[0], point[1] - y0, y1 - point[1]);
}

/**
 * Who keeps a path that several seats sit on.
 *
 * One seat in the painted interior and the rest on the stroke: the
 * interior keeps the whole path. Several seats well inside: they still
 * share it, and a later covering splits the cells rather than the ink.
 */
export function ownersOf(
  shape: Pick<MapShape, 'rings' | 'bounds'>,
  keys: readonly string[],
  at: ReadonlyMap<string, Point>,
): string[] {
  const scored = keys
    .map((key) => ({ key, inset: insetOf(shape, at.get(key)) }))
    .filter((row) => row.inset >= 0);
  if (scored.length === 0) return keys[0] !== undefined ? [keys[0]] : [];
  const interior = scored.filter((row) => row.inset >= RIM);
  if (interior.length === 1) return [interior[0]!.key];
  if (interior.length > 1) return interior.map((row) => row.key);
  return scored.map((row) => row.key);
}

/**
 * The seat on this path that sits farthest from its edge.
 *
 * A label dropped on the stroke is not a second country. The one in the
 * painted interior is.
 */
export function interiorKey(
  shape: Pick<MapShape, 'rings' | 'bounds'>,
  keys: readonly string[],
  at: ReadonlyMap<string, Point>,
): string | undefined {
  const owners = ownersOf(shape, keys, at);
  if (owners.length === 1) return owners[0];
  let best: string | undefined;
  let score = -1;
  for (const key of owners) {
    const inset = insetOf(shape, at.get(key));
    if (inset > score) {
      score = inset;
      best = key;
    }
  }
  return best ?? owners[0];
}

/**
 * Exclusive claims plus each contested path that has a single interior
 * seat. Paths several countries actually live in stay off these regions
 * so a covering can split them without overlapping anyone else.
 */
export function regionsOf(
  claim: ClaimResult,
  seats: readonly FillSeat[],
): LandRegion[] {
  const byKey = new Map<string, MapShape[]>();
  for (const [key, shapes] of claim.claimed) {
    byKey.set(key, [...shapes]);
  }
  const seatAt = new Map(seats.map((seat) => [seat.key, seat.at]));
  for (const contest of claim.contested) {
    const owners = ownersOf(contest.shape, contest.keys, seatAt);
    if (owners.length !== 1) continue;
    const key = owners[0]!;
    const held = byKey.get(key) ?? [];
    held.push(contest.shape);
    byKey.set(key, held);
  }
  return [...byKey].map(([key, shapes]) => ({
    key,
    shapes,
    at: seatAt.get(key),
    area: shapes.reduce((sum, shape) => sum + shape.area, 0),
  }));
}

/** Contested paths that more than one interior seat still shares. */
export function sharedContests(
  claim: ClaimResult,
  seats: readonly FillSeat[],
): { shape: MapShape; keys: readonly string[] }[] {
  const seatAt = new Map(seats.map((seat) => [seat.key, seat.at]));
  return claim.contested
    .map((contest) => ({
      shape: contest.shape,
      keys: ownersOf(contest.shape, contest.keys, seatAt),
    }))
    .filter((contest) => contest.keys.length > 1);
}

/**
 * Keep the parts of these cells that nobody holds yet.
 *
 * A cell already inside taken land is dropped. A cell that contains taken
 * land is split until the foreign squares are cut out, or until `maxLevel`,
 * where a leftover mixed cell is dropped rather than claimed twice.
 */
export function takeLand(
  tokens: readonly string[],
  taken: Taken,
  maxLevel: number,
): string[] {
  const kept = new Set<string>();
  for (const token of tokens) {
    for (const piece of carveCell(CellId.fromToken(token), taken, maxLevel)) {
      kept.add(piece);
    }
  }
  return [...kept];
}

/**
 * Cover every region, smallest painted area first, and keep only free cells.
 *
 * That is the canonical ownership: each stored cell belongs to at most one
 * key, and no key holds an ancestor of another key's cell. Finer squares
 * than `maxLevel` inherit that owner — a 5-foot leaf has one ancestor in
 * the covering, so it has one country.
 */
export function partitionOf(
  regions: readonly LandRegion[],
  fit: MapFit,
  options: CoveringOptions = {},
): Map<string, string[]> {
  const taken = new Taken();
  const out = new Map<string, string[]>();
  const maxLevel = options.maxLevel ?? 13;
  const ordered = [...regions].sort((a, b) =>
    a.area !== b.area ? a.area - b.area : a.key < b.key ? -1 : 1,
  );
  for (const region of ordered) {
    const raw = region.shapes.flatMap((shape) =>
      coveringOf(shape, fit, options),
    );
    const kept = takeLand(raw, taken, maxLevel);
    taken.addAll(kept);
    out.set(region.key, kept);
  }
  return out;
}

/**
 * Where two holdings nest or share a token.
 *
 * Empty means the map is a partition: borders are the sides of cells whose
 * neighbour is somebody else, not a second owner of the same ground.
 */
export function conflictsOf(
  holdings: ReadonlyMap<string, readonly string[]>,
): { a: string; b: string; token: string }[] {
  const owner = new Map<string, string>();
  const found: { a: string; b: string; token: string }[] = [];
  for (const [key, tokens] of holdings) {
    for (const token of tokens) {
      const had = owner.get(token);
      if (had !== undefined && had !== key) {
        found.push({ a: had, b: key, token });
      }
      owner.set(token, key);
    }
  }
  for (const [token, key] of owner) {
    let cell = CellId.fromToken(token);
    while (cell.level() > 0) {
      cell = cell.parent();
      const parentKey = owner.get(cell.token());
      if (parentKey !== undefined && parentKey !== key) {
        found.push({ a: parentKey, b: key, token });
        break;
      }
    }
  }
  return found;
}

function carveCell(cell: CellId, taken: Taken, maxLevel: number): string[] {
  if (taken.covered(cell)) return [];
  if (!taken.containsHeld(cell)) return [cell.token()];
  if (cell.level() >= maxLevel) return [];
  return cell.children().flatMap((child) => carveCell(child, taken, maxLevel));
}
