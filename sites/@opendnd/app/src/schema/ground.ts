import {
  type Cell,
  type LatLng,
  type View,
  cellAt,
  cellAtLatLng,
  centerOf,
  contains,
  parseCell,
  pointWithin,
} from './cells';

/**
 * The ground places hold, and the borders that follow from it.
 *
 * A border is not drawn and not stored: it is where a holding ends. Every
 * point of a world lies in exactly one cell at every level, so who holds a
 * square is a prefix test on the cells a place owns — the same test at a
 * continent's level and at the five-foot square ADR-006 promises. A side of
 * a cell is border where the ground across it is somebody else's, and
 * nowhere else. Hand a cell to another place and the border moves, because
 * that is all a border moving is.
 *
 * Drawing the cells themselves is what makes a map of squares, and no
 * country can be drawn to the pixel that way: its inside costs as much as
 * its edge. So the cells are only ever asked the question — who is across
 * this side — and what is drawn is the answer joined up: one outline per
 * country, and the stretches of it where a neighbour begins. The cost is
 * then the length of a border rather than the area behind it, which is what
 * lets the line be drawn as finely as it is held.
 */

/** How fine a cell may be drawn, whatever the zoom. */
const FINEST = 20;

/**
 * How many squares the layer will walk before it settles for coarser ones.
 *
 * Ground is held finely only where a border runs, so rolling it up to a
 * level mostly counts the squares that border passes through: a hundred and
 * fifty countries come to about ninety thousand squares between them at the
 * level where their coasts stop being squares, and about a third of that
 * one level coarser. A budget that stops short of the first number buys
 * nothing but a staircase — the whole world is drawn coarse to save work on
 * country interiors that are merged into a handful of blocks anyway.
 */
const BUDGET = 100_000;

/**
 * How coarsely a place is held for the question "can this be seen from
 * here". Coarse enough that a country is a handful of cells, fine enough
 * that a small one is not lost in a cell the size of a continent.
 */
const VIEW_LEVEL = 6;

/**
 * How much coarser than the drawing a block may be after its neighbours are
 * merged into it. A block is walked one drawn square at a time along each
 * side, so this bounds that walk at sixty-four steps a side.
 */
const COARSEST = 6;

/** How much of a square a place holds before the square is its own. */
const HALF = 0.5;

/**
 * How much coarser than the drawing a place's ground may be said and still
 * be drawn: four levels, so a block sixteen times the drawn square's width.
 */
const SLACK = 4;

export interface Holding {
  readonly model: string;
  readonly resource: {
    readonly id?: unknown;
    readonly extent?: unknown;
    readonly type?: unknown;
  };
}

export interface Ground {
  /** The outline of the ground held: closed rings, holes among them. */
  readonly fills: LatLng[][];
  /** The stretches of that outline another place is across, as lines. */
  readonly borders: LatLng[][];
  /** Places that share a side with this one, for colouring them apart. */
  readonly neighbors: readonly string[];
}

/**
 * Tokens already parsed, because a level is chosen by trying two or three of
 * them and a world's extents are a quarter of a million tokens.
 */
const parsed = new Map<string, Cell | undefined>();

function cellOf(token: string): Cell | undefined {
  if (parsed.has(token)) return parsed.get(token);
  const cell = parseCell(token);
  if (parsed.size > 1_600_000) parsed.clear();
  parsed.set(token, cell);
  return cell;
}

/**
 * A square named by where it is rather than by its token.
 *
 * A token is a sixty-four bit id in hex, and making one means interleaving
 * thirty pairs of bits and formatting a string. That is the right name for a
 * cell to travel or be stored under, and the wrong one to ask a question
 * with: drawing a layer asks about the squares across a few hundred thousand
 * sides, and none of those answers is kept. So the drawing works in face,
 * column, row and level, which are numbers, and keys them as one number —
 * exact to a level of twenty, which is finer than the map is ever drawn.
 */
const SPAN = 1_048_576;

function keyOf(face: number, i: number, j: number, level: number): number {
  return ((face * SPAN + i) * SPAN + j) * 32 + level;
}

/**
 * A cell that works out its token if anybody asks for it.
 *
 * Nothing in the drawing does, so nothing in the drawing pays for it.
 */
function square(face: number, i: number, j: number, level: number): Cell {
  let token: string | undefined;
  return {
    face,
    i,
    j,
    level,
    get token(): string {
      token ??= cellAt(face, i, j, level).token;
      return token;
    },
  };
}

export interface Rolled {
  readonly cell: Cell;
  /** How much of this coarser cell the place holds, from none to all of it. */
  readonly part: number;
}

/**
 * A place's cells at one level, remembered.
 *
 * Rolling up is the expensive half of the layer and depends only on the
 * place and the level, so it is kept; panning refetches mostly the same
 * places and asks the same question of them again.
 */
const rolled = new Map<string, Rolled[]>();

/**
 * A place's ground as squares of one level.
 *
 * A square goes to a place when the place holds most of it. Handing it over
 * for holding any of it at all is how a coast painted to within half a pixel
 * comes out as a staircase in the sea: every square a border passes through
 * would belong to both sides and be drawn whole by each. Most-of-it keeps
 * the coarse map a partition, and keeps it close to the fine one — a square
 * only changes hands where it was half and half to begin with.
 *
 * A place too small to hold most of any square keeps the square it holds
 * most of, so that zooming out loses countries' shapes but not countries.
 */
export function rollUp(
  id: string,
  extent: readonly unknown[],
  level: number,
): Rolled[] {
  // The extent is part of the key, not just the place: a border that moves
  // moves by the extent changing, and a cache that remembered the place
  // would go on drawing the old one.
  const stamp = `${extent.length}/${String(extent[0])}/${String(
    extent[extent.length - 1],
  )}`;
  const key = `${id}:${level}:${stamp}`;
  const had = rolled.get(key);
  if (had) return had;
  const seen = new Map<number, { cell: Cell; part: number }>();
  for (const token of extent) {
    const cell = cellOf(String(token));
    if (!cell) continue;
    const deeper = cell.level - level;
    const [face, i, j, at] =
      deeper <= 0
        ? [cell.face, cell.i, cell.j, cell.level]
        : [cell.face, cell.i >>> deeper, cell.j >>> deeper, level];
    const part = deeper <= 0 ? 1 : 4 ** -deeper;
    const held = seen.get(keyOf(face, i, j, at));
    if (held) held.part = Math.min(1, held.part + part);
    else {
      seen.set(keyOf(face, i, j, at), {
        cell: at === cell.level ? cell : square(face, i, j, at),
        part: Math.min(1, part),
      });
    }
  }
  const all = [...seen.values()];
  let out = all.filter(({ part }) => part >= HALF);
  if (out.length === 0 && all.length > 0) {
    out = [all.reduce((best, at) => (at.part > best.part ? at : best))];
  }
  if (rolled.size > 4000) rolled.clear();
  rolled.set(key, out);
  return out;
}

/** The finest level a place's ground is held at, remembered by extent. */
const sharpest = new Map<string, number>();

/**
 * Whether a place has said anything about its ground at about the fineness
 * being drawn.
 *
 * Ground is held as finely as somebody troubled to say. A continent traced
 * in squares a hundred pixels across is a true statement about where the
 * land is, and drawing it beside countries traced to the pixel is a false
 * one: its squares read as borders, and they cut across coastlines and out
 * to sea. So a holding is drawn while the drawing is no finer than the
 * holding, and when the map gets finer than that, the holding steps aside
 * for whoever has been more precise — which is what zooming into a
 * continent and finding its countries ought to feel like.
 */
function finestOf(holding: Holding): number {
  const extent = holding.resource.extent;
  if (!Array.isArray(extent) || extent.length === 0) return -1;
  const key = `${String(holding.resource.id)}:${extent.length}/${String(
    extent[0],
  )}`;
  const had = sharpest.get(key);
  if (had !== undefined) return had;
  let finest = 0;
  for (const token of extent) {
    const cell = cellOf(String(token));
    if (cell && cell.level > finest) finest = cell.level;
  }
  if (sharpest.size > 4000) sharpest.clear();
  sharpest.set(key, finest);
  return finest;
}

function speaks(holding: Holding, level: number): boolean {
  const finest = finestOf(holding);
  return finest >= 0 && finest >= level - SLACK;
}

/** Whether a place on the world is within a view of it. */
function seen(at: LatLng, view: View): boolean {
  if (at.lat < view.south || at.lat > view.north) return false;
  if (view.east - view.west >= 360) return true;
  let lng = at.lng;
  while (lng < view.west) lng += 360;
  return lng <= view.east;
}

/**
 * The places whose ground a view can see.
 *
 * The layer is fetched for the whole world, because a country whose capital
 * is off-screen is still a country and must still be coloured. Drawing the
 * whole world at the grain of the view, though, is a hundred and fifty
 * countries' worth of cells spent on the one you are looking at: the budget
 * would be gone and every border would be drawn coarse. So the drawing is
 * of what is in view, and the rest waits.
 *
 * A place is in view if any of its ground is, which is two questions: a
 * piece of it inside the view, and the view inside a piece of it — the
 * second being how a continent is seen from a valley.
 */
export function inView<T extends Holding>(
  holdings: readonly T[],
  view: View,
): T[] {
  const under = new Set<number>();
  for (let row = 0; row <= 2; row += 1) {
    for (let col = 0; col <= 2; col += 1) {
      const lat = view.south + ((view.north - view.south) * row) / 2;
      const lng = view.west + ((view.east - view.west) * col) / 2;
      const cell = cellAtLatLng({ lat, lng }, VIEW_LEVEL);
      for (let level = cell.level; level >= 0; level--) {
        const back = cell.level - level;
        under.add(keyOf(cell.face, cell.i >>> back, cell.j >>> back, level));
      }
    }
  }
  return holdings.filter((holding) => {
    const extent = holding.resource.extent;
    if (!Array.isArray(extent) || extent.length === 0) return false;
    const held = rollUp(String(holding.resource.id), extent, VIEW_LEVEL);
    return held.some(
      ({ cell }) =>
        under.has(keyOf(cell.face, cell.i, cell.j, cell.level)) ||
        seen(centerOf(cell), view),
    );
  });
}

/**
 * How fine to draw: as fine as a pixel can show, never finer than anybody
 * has said, and as coarse as the budget needs.
 *
 * A cell of level `zoom + 7` is about half a pixel across, which is the
 * point past which fineness is spent on nothing. Asking finer than the
 * ground is held is worse than pointless: the question is then put to
 * squares nobody has an answer for, and the layer goes blank at exactly the
 * zoom where a border matters most. So the finest thing said in view is the
 * ceiling, and a world with more border than can be drawn gives up levels
 * until it fits — everywhere at once, so the map stays a partition rather
 * than a patchwork of resolutions.
 */
export function levelToDraw(
  holdings: readonly Holding[],
  zoom: number,
  budget = BUDGET,
): number {
  let said = 0;
  for (const holding of holdings) said = Math.max(said, finestOf(holding));
  let level = Math.min(FINEST, said, Math.max(2, Math.round(zoom) + 7));
  for (;;) {
    let count = 0;
    for (const holding of holdings) {
      const extent = holding.resource.extent;
      if (!Array.isArray(extent) || !speaks(holding, level)) continue;
      count += rollUp(String(holding.resource.id), extent, level).length;
      if (count > budget) break;
    }
    if (count <= budget || level <= 2) return level;
    level--;
  }
}

/**
 * Who holds each cell at one level, and the ground each place says is its
 * own.
 *
 * These are two different questions and the layer needs both. Places nest —
 * a kingdom sits on a continent, and both say so honestly — so the ground
 * under a kingdom is claimed twice, and the answer to "whose is this
 * square" is the smaller holder, or a political map would be two colours.
 *
 * What is drawn, though, is each place's own ground, not the ground left to
 * it once its kingdoms are taken out. A continent holds the square its
 * kingdom stands on: saying otherwise means cutting a hole in a continent
 * traced in squares the size of a province, and a shape with a hole nobody
 * traced is not a shape — its outline breaks where the hole is, and
 * whatever draws it closes the break with a straight line across the
 * continent. So each place is outlined whole, the larger ones first, and the
 * kingdom is drawn over the continent it sits on.
 */
function whoHolds(
  holdings: readonly Holding[],
  level: number,
): { owner: Map<number, string>; held: Map<string, Cell[]> } {
  const size = new Map<string, number>();
  const kinds = new Map<string, string>();
  const own = new Map<string, Cell[]>();
  for (const holding of holdings) {
    const extent = holding.resource.extent;
    if (!Array.isArray(extent) || extent.length === 0) continue;
    if (!speaks(holding, level)) continue;
    const key = `${holding.model}/${String(holding.resource.id)}`;
    size.set(key, extent.length);
    if (typeof holding.resource.type === 'string' && holding.resource.type) {
      kinds.set(key, holding.resource.type);
    }
    own.set(
      key,
      rollUp(String(holding.resource.id), extent, level).map(
        ({ cell }) => cell,
      ),
    );
  }
  const peers = (a: string, b: string) => sameKind(a, b, kinds, size);
  // A kingdom stored as a coarse inland square still covers its
  // neighbours until those neighbours are cut out of it. Continents keep
  // the square a kingdom stands on, so only a peer is carved away.
  const carved = carvePeers(own, peers);
  const claims = new Map<number, Map<string, number>>();
  for (const [key, cells] of carved) {
    for (const cell of cells) {
      const at = keyOf(cell.face, cell.i, cell.j, cell.level);
      const byPlace = claims.get(at) ?? new Map<string, number>();
      byPlace.set(key, 1);
      claims.set(at, byPlace);
    }
  }
  const owner = new Map<number, string>();
  for (const [at, byPlace] of claims) {
    let best: string | undefined;
    let bestHeld = Infinity;
    let bestCount = 0;
    for (const [key, part] of byPlace) {
      const held = size.get(key) ?? Infinity;
      // A kingdom on a continent is the finer thing said about that
      // ground, so the smaller holder wins when the two are different
      // kinds. Two countries of a kind are a partition: whoever holds
      // more of the square keeps it, or a neighbour that only touches a
      // corner would paint over the country that holds the rest.
      const nest = best !== undefined && !peers(key, best);
      const better =
        best === undefined ||
        (nest
          ? held < bestHeld ||
            (held === bestHeld &&
              (part > bestCount || (part === bestCount && key < best)))
          : part > bestCount ||
            (part === bestCount &&
              (held < bestHeld || (held === bestHeld && key < best))));
      if (better) {
        best = key;
        bestHeld = held;
        bestCount = part;
      }
    }
    if (best !== undefined) owner.set(at, best);
  }
  // Largest holder first, so that the ground a kingdom shares with its
  // continent is painted the kingdom's colour. A neighbour of the same
  // kind is not drawn over the country that actually holds the square.
  const order = [...carved.keys()].sort(
    (a, b) => (size.get(b) ?? 0) - (size.get(a) ?? 0) || (a < b ? -1 : 1),
  );
  const held = new Map<string, Cell[]>();
  for (const key of order) {
    const cells = (carved.get(key) ?? []).filter((cell) => {
      const who = owner.get(keyOf(cell.face, cell.i, cell.j, cell.level));
      if (who === undefined || who === key) return true;
      return !peers(key, who);
    });
    held.set(key, standing(cells));
  }
  return { owner, held };
}

/**
 * Whether two holdings are the same kind of place.
 *
 * Type is the honest signal — a kingdom is not a continent. When nobody
 * said, size is the stand-in: a kingdom is a few times smaller than its
 * continent, never four provinces beside each other.
 */
function sameKind(
  a: string,
  b: string,
  kinds: ReadonlyMap<string, string>,
  size: ReadonlyMap<string, number>,
): boolean {
  const ta = kinds.get(a);
  const tb = kinds.get(b);
  if (ta !== undefined && tb !== undefined) return ta === tb;
  const sa = size.get(a) ?? 0;
  const sb = size.get(b) ?? 0;
  if (sa === 0 || sb === 0) return true;
  return sa * 4 >= sb && sb * 4 >= sa;
}

function sameCell(a: Cell, b: Cell): boolean {
  return (
    a.face === b.face && a.level === b.level && a.i === b.i && a.j === b.j
  );
}

function childrenOf(cell: Cell): Cell[] {
  return [
    square(cell.face, cell.i * 2, cell.j * 2, cell.level + 1),
    square(cell.face, cell.i * 2 + 1, cell.j * 2, cell.level + 1),
    square(cell.face, cell.i * 2, cell.j * 2 + 1, cell.level + 1),
    square(cell.face, cell.i * 2 + 1, cell.j * 2 + 1, cell.level + 1),
  ];
}

/**
 * `cell` with every hole that sits strictly inside it cut out, as the
 * leftover siblings of those holes. The exact square a neighbour also
 * claims is left in, so who holds more of it can still decide.
 */
function minus(cell: Cell, holes: readonly Cell[]): Cell[] {
  const inside = holes.filter((hole) => contains(cell, hole));
  if (inside.length === 0) return [cell];
  // The same square said by two places stays; who holds more of it
  // decides. A neighbour sitting *inside* this square is cut out, and
  // that child is not kept — keeping it lets four siblings merge back
  // into the square we just split.
  if (inside.some((hole) => sameCell(hole, cell))) return [cell];
  if (cell.level >= FINEST) return [cell];
  return childrenOf(cell).flatMap((child) => {
    const childHoles = inside.filter((hole) => contains(child, hole));
    if (childHoles.some((hole) => sameCell(hole, child))) return [];
    return minus(child, childHoles);
  });
}

function carvePeers(
  own: ReadonlyMap<string, Cell[]>,
  peers: (a: string, b: string) => boolean,
): Map<string, Cell[]> {
  // A cell sits inside every ancestor of it. Index once so carving a
  // coarse inland square looks up who is in it, instead of testing every
  // other country's cells.
  const sitting = new Map<number, { key: string; cell: Cell }[]>();
  for (const [key, cells] of own) {
    for (const cell of cells) {
      for (let level = cell.level; level >= 0; level--) {
        const back = cell.level - level;
        const at = keyOf(cell.face, cell.i >>> back, cell.j >>> back, level);
        const had = sitting.get(at);
        if (had) had.push({ key, cell });
        else sitting.set(at, [{ key, cell }]);
      }
    }
  }
  const out = new Map<string, Cell[]>();
  for (const [key, cells] of own) {
    const carved: Cell[] = [];
    for (const cell of cells) {
      const holes = (sitting.get(keyOf(cell.face, cell.i, cell.j, cell.level)) ?? [])
        .filter((other) => other.key !== key && peers(key, other.key))
        .map((other) => other.cell);
      carved.push(...minus(cell, holes));
    }
    out.set(key, carved);
  }
  return out;
}

/**
 * A place's cells with any that sit inside another of them dropped.
 *
 * A place may say both "this province is mine" and "this square in it is
 * mine", and the square adds nothing: it is already held. Left in, it is a
 * second shape over the first, and the side it shares with the world
 * outside gets drawn twice — once by each — which is one side too many for
 * an outline to be followed round.
 */
function standing(cells: readonly Cell[]): Cell[] {
  const at = new Set<number>();
  for (const cell of cells)
    at.add(keyOf(cell.face, cell.i, cell.j, cell.level));
  return cells.filter((cell) => {
    for (let level = cell.level - 1; level >= 0; level--) {
      const back = cell.level - level;
      if (at.has(keyOf(cell.face, cell.i >>> back, cell.j >>> back, level))) {
        return false;
      }
    }
    return true;
  });
}

/** Who holds the ground a square covers, by asking of it and of everything above it. */
function holderAt(
  owner: ReadonlyMap<number, string>,
  face: number,
  i: number,
  j: number,
  level: number,
): string | undefined {
  for (let at = level; at >= 0; at--) {
    const back = level - at;
    const key = owner.get(keyOf(face, i >>> back, j >>> back, at));
    if (key !== undefined) return key;
  }
  return undefined;
}

/**
 * Four cells of one place that make up a whole parent become the parent.
 *
 * This throws nothing away — a parent whose every child is held is held —
 * and it is what keeps the inside of a country a handful of shapes rather
 * than a thousand squares.
 */
function coalesce(cells: readonly Cell[], floor: number): Cell[] {
  let current = [...cells];
  for (;;) {
    const byParent = new Map<number, Cell[]>();
    const kept: Cell[] = [];
    for (const cell of current) {
      if (cell.level <= floor) {
        kept.push(cell);
        continue;
      }
      const at = keyOf(cell.face, cell.i >>> 1, cell.j >>> 1, cell.level - 1);
      const group = byParent.get(at);
      if (group) group.push(cell);
      else byParent.set(at, [cell]);
    }
    const out = [...kept];
    let merged = false;
    for (const group of byParent.values()) {
      const one = group[0]!;
      const whole =
        group.length === 4 && group.every((cell) => cell.level === one.level);
      if (whole) {
        out.push(square(one.face, one.i >>> 1, one.j >>> 1, one.level - 1));
        merged = true;
      } else out.push(...group);
    }
    current = out;
    if (!merged) return current;
  }
}

/** A run of points with its longitudes kept continuous, or nothing across the seam. */
function continuous(points: readonly LatLng[]): LatLng[] | undefined {
  const first = points[0]?.lng;
  if (first === undefined) return undefined;
  const fixed = points.map((point) => {
    let lng = point.lng;
    while (lng - first > 180) lng -= 360;
    while (first - lng > 180) lng += 360;
    return { lat: point.lat, lng };
  });
  const lngs = fixed.map((point) => point.lng);
  if (Math.max(...lngs) - Math.min(...lngs) > 180) return undefined;
  return fixed;
}

/**
 * A point a fraction of the way along one side of a block, going round it
 * the same way every time.
 *
 * The way round is what makes the outline drawable. A square walked top
 * left-to-right, right top-to-bottom, bottom right-to-left and left
 * bottom-to-top keeps its inside on the same hand throughout, so where two
 * squares of one country meet they walk their shared side in opposite
 * directions and both drop it, and what is left of a country's sides is a
 * set of loops that each close. Walked in any order they are a heap of
 * segments that happen to touch, and joining those guesses at the corners —
 * which is how an outline comes out open and gets closed, by whatever draws
 * it, with a straight line across the country.
 */
function atSide(cell: Cell, side: number, u: number): LatLng {
  switch (side) {
    case 0:
      return pointWithin(cell, u, 0);
    case 1:
      return pointWithin(cell, 1, u);
    case 2:
      return pointWithin(cell, 1 - u, 1);
    default:
      return pointWithin(cell, 0, 1 - u);
  }
}

/** Where a square is, without the cost of naming it. */
interface Where {
  readonly face: number;
  readonly i: number;
  readonly j: number;
  readonly level: number;
}

/**
 * The square across one step of a block's side.
 *
 * Within a face this is arithmetic on the column and row. Off the edge of a
 * face it is not — the neighbour is on another face, turned — so there the
 * question is asked of a point just outside the side instead, which the
 * projection answers without anybody writing down how the faces join.
 */
function acrossOf(
  block: Cell,
  side: number,
  step: number,
  span: number,
  level: number,
): Where {
  const i = block.i * span;
  const j = block.j * span;
  const back = span - 1 - step;
  const at =
    side === 0
      ? { i: i + step, j: j - 1 }
      : side === 1
        ? { i: i + span, j: j + step }
        : side === 2
          ? { i: i + back, j: j + span }
          : { i: i - 1, j: j + back };
  const edge = 2 ** level;
  if (at.i >= 0 && at.j >= 0 && at.i < edge && at.j < edge) {
    return { face: block.face, i: at.i, j: at.j, level };
  }
  // Half a square of the drawn level outside the side, which is inside the
  // neighbour whichever face it turns out to be on.
  const out = 0.5 / span;
  const u = (step + 0.5) / span;
  const outside =
    side === 0
      ? pointWithin(block, u, -out)
      : side === 1
        ? pointWithin(block, 1 + out, u)
        : side === 2
          ? pointWithin(block, 1 - u, 1 + out)
          : pointWithin(block, -out, 1 - u);
  return cellAtLatLng(outside, level);
}

/** Whether a square is inside the ground a place holds. */
function inside(mine: ReadonlySet<number>, at: Where): boolean {
  for (let level = at.level; level >= 0; level--) {
    const back = at.level - level;
    if (mine.has(keyOf(at.face, at.i >>> back, at.j >>> back, level))) {
      return true;
    }
  }
  return false;
}

/** A stretch of the edge of a holding, and who is on the far side of it. */
interface Piece {
  readonly a: LatLng;
  readonly b: LatLng;
  readonly other: string | undefined;
}

/**
 * The stretches of a block's sides that are not inside the place's own
 * ground, in the order they are walked.
 *
 * Each side is asked one drawn square at a time, whatever the level of the
 * block, so that a long side and the short sides facing it break at the same
 * places and can be joined end to end. Neighbouring steps with the same
 * answer become one stretch, because a side facing one country the whole way
 * along is one edge of the map, not sixty-four of them.
 */
function edgeOf(
  block: Cell,
  mine: ReadonlySet<number>,
  owner: ReadonlyMap<number, string>,
  level: number,
): Piece[] {
  const pieces: Piece[] = [];
  const span = Math.max(1, 2 ** (level - block.level));
  for (let side = 0; side < 4; side++) {
    let from = -1;
    let other: string | undefined;
    const cut = (step: number): void => {
      pieces.push({
        a: atSide(block, side, from / span),
        b: atSide(block, side, step / span),
        other,
      });
      from = -1;
    };
    for (let step = 0; step < span; step++) {
      const at = acrossOf(block, side, step, span, level);
      if (inside(mine, at)) {
        if (from >= 0) cut(step);
        continue;
      }
      const holder = holderAt(owner, at.face, at.i, at.j, at.level);
      if (from >= 0 && holder !== other) cut(step);
      if (from < 0) {
        from = step;
        other = holder;
      }
    }
    if (from >= 0) cut(span);
  }
  return pieces;
}

/**
 * How near two corners must be to be the same corner: a millionth of a
 * degree, about a hand's breadth. Squares of the finest level drawn are tens
 * of metres across, so nothing this close is two places.
 */
const GRAIN = 1e-6;

/**
 * Corners named by which corner they are, rather than by their coordinates.
 *
 * Two squares meeting at a corner work it out from their own column and row,
 * and within one face of the world they get bit-for-bit the same answer. Two
 * faces do not: the same corner is a different sum on each side of the seam,
 * and the answers differ in the last place — as they do either side of the
 * antimeridian, where a corner is both 180 and -180. Comparing the numbers
 * therefore breaks the outline into pieces exactly at the seams, and an
 * outline in pieces is drawn as a shape by closing it with a straight line
 * across the country.
 *
 * So a corner is looked up rather than compared: near enough to one already
 * seen and it is that one. Near enough is a grid, with its neighbours
 * checked, because two numbers a hair apart can still land either side of a
 * grid line.
 */
class Corners {
  private readonly at = new Map<string, number>();
  private next = 0;

  id(point: LatLng): number {
    let lng = point.lng;
    while (lng >= 180) lng -= 360;
    while (lng < -180) lng += 360;
    const row = Math.round(point.lat / GRAIN);
    const col = Math.round(lng / GRAIN);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const had = this.at.get(`${row + dr}:${col + dc}`);
        if (had !== undefined) return had;
      }
    }
    const id = this.next++;
    this.at.set(`${row}:${col}`, id);
    return id;
  }
}

/**
 * Stretches joined head to tail into as few lines as they make.
 *
 * The edge of a holding is found a square at a time, and a square at a time
 * is no way to draw it: a country would be a thousand paths, which is what
 * makes a political layer slow and what makes it look like a grid. Joined
 * up, the same country is one line — closed where it is the country's whole
 * outline, open where it is the stretch of border it shares with one
 * neighbour.
 *
 * Because every stretch is walked with the country's ground on the same
 * hand, joining is following each one to the stretch that begins where it
 * ends. An outline therefore arrives back where it started rather than
 * needing to be closed by guesswork.
 */
function join(pieces: readonly Piece[]): LatLng[][] {
  const corners = new Corners();
  const head = pieces.map((piece) => corners.id(piece.a));
  const tail = pieces.map((piece) => corners.id(piece.b));
  const from = new Map<number, number[]>();
  const to = new Map<number, number[]>();
  pieces.forEach((_, index) => {
    const starts = from.get(head[index]!);
    if (starts) starts.push(index);
    else from.set(head[index]!, [index]);
    const ends = to.get(tail[index]!);
    if (ends) ends.push(index);
    else to.set(tail[index]!, [index]);
  });
  const used = pieces.map(() => false);
  const lines: LatLng[][] = [];
  for (let index = 0; index < pieces.length; index++) {
    if (used[index]) continue;
    used[index] = true;
    const line = [pieces[index]!.a, pieces[index]!.b];
    let start = head[index]!;
    let end = tail[index]!;
    for (;;) {
      if (end === start) break;
      const next = (from.get(end) ?? []).find((at) => !used[at]);
      if (next === undefined) break;
      used[next] = true;
      line.push(pieces[next]!.b);
      end = tail[next]!;
    }
    // An outline is closed by now; a stretch of border is not, and its
    // earlier steps are still to be found.
    for (;;) {
      if (start === end) break;
      const prev = (to.get(start) ?? []).find((at) => !used[at]);
      if (prev === undefined) break;
      used[prev] = true;
      line.unshift(pieces[prev]!.a);
      start = head[prev]!;
    }
    const run = continuous(line);
    if (run) lines.push(run);
  }
  return lines;
}

/**
 * What to draw for each place that holds ground: the outline of the ground
 * it holds, and the stretches of that outline where another place begins.
 *
 * Both come out of the same walk. Every step of every block's side is asked
 * who is across it: the steps where the answer is not the place itself are
 * its outline, and the ones where the answer is another place are its
 * borders. The rest of the outline is coast, which the world's own
 * coastlines already draw.
 */
export function groundOf(
  holdings: readonly Holding[],
  level: number,
): Map<string, Ground> {
  const { owner, held } = whoHolds(holdings, level);
  const out = new Map<string, Ground>();
  for (const [key, cells] of held) {
    if (cells.length === 0) continue;
    const blocks = coalesce(cells, Math.max(0, level - COARSEST));
    const mine = new Set<number>();
    for (const block of blocks) {
      mine.add(keyOf(block.face, block.i, block.j, block.level));
    }
    const edge: Piece[] = [];
    for (const block of blocks) edge.push(...edgeOf(block, mine, owner, level));
    const neighbors = new Set<string>();
    for (const piece of edge) {
      if (piece.other !== undefined) neighbors.add(piece.other);
    }
    out.set(key, {
      fills: join(edge),
      borders: join(edge.filter((piece) => piece.other !== undefined)),
      neighbors: [...neighbors],
    });
  }
  return out;
}
