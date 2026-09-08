/**
 * Where water goes.
 *
 * Three steps that have to happen in this order, and the first of them is the
 * one everybody skips. Noise leaves a field full of pits; a river running
 * into one stops there, which is why generated worlds are so often full of
 * rivers that end in a field. Fill the pits first and every drop has a way to
 * the sea, and then rivers are not something to route by hand — they are
 * wherever enough water has gathered.
 */

/** The eight neighbours, as offsets, and how far each is. */
const AROUND: readonly (readonly [dx: number, dy: number, span: number])[] = [
  [-1, -1, Math.SQRT2],
  [0, -1, 1],
  [1, -1, Math.SQRT2],
  [-1, 0, 1],
  [1, 0, 1],
  [-1, 1, Math.SQRT2],
  [0, 1, 1],
  [1, 1, Math.SQRT2],
];

export interface Grid {
  readonly width: number;
  readonly height: number;
  /**
   * Whether the east edge is the west edge, which on a world it is. Water
   * running off one side of the map arrives on the other, and a continent
   * straddling the meridian is one continent.
   */
  readonly wrapX?: boolean;
}

/** The column `x` means on this grid, wrapped round the world if it wraps. */
export function columnOn(grid: Grid, x: number): number {
  if (x >= 0 && x < grid.width) return x;
  if (grid.wrapX !== true) return -1;
  return ((x % grid.width) + grid.width) % grid.width;
}

/**
 * Raise every pit until water can leave it.
 *
 * Priority flood: start from everywhere water may leave the world — the sea,
 * and the edges — and walk inwards always taking the lowest place left,
 * raising anything lower than where you came from to just above it. What
 * comes back has no depression in it that is not an outlet, so a walk
 * downhill from anywhere on land reaches the sea.
 *
 * `sink` marks cells that are allowed to swallow water and keep it: the sea,
 * and any lake the world says is a lake.
 */
export interface Drained {
  /** The ground with every pit raised until water can leave it. */
  readonly elevation: Float32Array;
  /**
   * For each cell, the neighbour the flood reached it from, or -1 for one it
   * started at. That neighbour is by construction on a path to an outlet, so
   * it is the way out of a flat where no neighbour is strictly lower — which
   * is what a filled pit leaves behind, and what would otherwise strand a
   * river on the plain it made.
   */
  readonly towards: Int32Array;
}

export function fillPits(
  grid: Grid,
  elevation: Float32Array,
  sink: Uint8Array,
  epsilon = 1e-4,
): Drained {
  const { width, height } = grid;
  const count = width * height;
  const filled = new Float32Array(elevation);
  const settled = new Uint8Array(count);
  const towards = new Int32Array(count).fill(-1);
  const queue = new Heap(count);

  for (let i = 0; i < count; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    // Water may leave at the poles, and at the east and west edges only when
    // the world does not join up there.
    const edge =
      y === 0 ||
      y === height - 1 ||
      (grid.wrapX !== true && (x === 0 || x === width - 1));
    if (sink[i] === 1 || edge) {
      settled[i] = 1;
      queue.push(i, filled[i]!);
    }
  }

  while (queue.size > 0) {
    const here = queue.pop();
    const x = here % width;
    const y = Math.floor(here / width);
    for (const [dx, dy] of AROUND) {
      const nx = columnOn(grid, x + dx);
      const ny = y + dy;
      if (nx < 0 || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (settled[next] === 1) continue;
      settled[next] = 1;
      towards[next] = here;
      // Just above where we came from, so the way out keeps going down.
      if (filled[next]! <= filled[here]!) {
        filled[next] = filled[here]! + epsilon;
      }
      queue.push(next, filled[next]!);
    }
  }
  return { elevation: filled, towards };
}

export interface Flow {
  /** Where each cell sends its water, or -1 for a cell that keeps it. */
  readonly to: Int32Array;
  /** How much has gathered by the time it leaves each cell. */
  readonly accumulated: Float32Array;
}

/**
 * Which way each cell drains, and how much has gathered by the time it gets
 * there.
 *
 * Steepest of the eight neighbours, weighted by how far away each is so a
 * diagonal does not win by being longer. Then every cell is handed its own
 * rain plus everything above it, walking from the highest cell down, which
 * needs no recursion and visits each cell once.
 */
export function flowOver(
  grid: Grid,
  elevation: Float32Array,
  rain: Float32Array,
  sink: Uint8Array,
  /** The flood's way out, for the flats where nothing is lower. */
  towards?: Int32Array,
): Flow {
  const { width, height } = grid;
  const count = width * height;
  const to = new Int32Array(count).fill(-1);
  const accumulated = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    accumulated[i] = rain[i]!;
    if (sink[i] === 1) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    let steepest = 0;
    for (const [dx, dy, span] of AROUND) {
      const nx = columnOn(grid, x + dx);
      const ny = y + dy;
      if (nx < 0 || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      const fall = (elevation[i]! - elevation[next]!) / span;
      if (fall > steepest) {
        steepest = fall;
        to[i] = next;
      }
    }
    // A filled pit is a flat, and on a flat nothing is lower. The flood came
    // in from somewhere, and where it came from leads out.
    if (to[i]! < 0 && towards !== undefined && towards[i]! >= 0) {
      to[i] = towards[i]!;
    }
  }

  // High to low, so a cell is only passed on once everything above it has
  // been. Sorted in place in the typed array: copying a world of cells into
  // an ordinary array to sort it costs more than the sort.
  const order = new Int32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  order.sort((a, b) => elevation[b]! - elevation[a]!);
  for (const i of order) {
    const next = to[i]!;
    if (next >= 0) accumulated[next] = accumulated[next]! + accumulated[i]!;
  }
  return { to, accumulated };
}

/**
 * The cells a river runs through: those carrying more than `least`, on land.
 *
 * Found rather than drawn. Because the field has no pits and the sea is the
 * only sink, a cell carrying a great deal of water necessarily has a great
 * deal of ground above it and a way down to the sea below it — which is what
 * makes these rivers rather than blue lines.
 */
export function riversIn(
  flow: Flow,
  land: Uint8Array,
  least: number,
): Uint8Array {
  const rivers = new Uint8Array(flow.accumulated.length);
  for (let i = 0; i < rivers.length; i += 1) {
    if (land[i] === 1 && flow.accumulated[i]! >= least) rivers[i] = 1;
  }
  return rivers;
}

/**
 * One river as a run of cells, from where it becomes a river to where it
 * ends. Following the flow, so it can only end in the sea or a lake.
 */
export function traceRiver(
  flow: Flow,
  from: number,
  stop: Uint8Array,
): number[] {
  const path: number[] = [];
  const seen = new Set<number>();
  let at = from;
  while (at >= 0 && !seen.has(at)) {
    seen.add(at);
    path.push(at);
    if (stop[at] === 1) break;
    at = flow.to[at]!;
  }
  return path;
}

/** A binary heap keyed by height, for the flood. */
class Heap {
  private readonly items: Int32Array;
  private readonly keys: Float32Array;
  size = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Float32Array(capacity);
  }

  push(item: number, key: number): void {
    let i = this.size;
    this.size += 1;
    this.items[i] = item;
    this.keys[i] = key;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    this.size -= 1;
    this.items[0] = this.items[this.size]!;
    this.keys[0] = this.keys[this.size]!;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let least = i;
      if (left < this.size && this.keys[left]! < this.keys[least]!) {
        least = left;
      }
      if (right < this.size && this.keys[right]! < this.keys[least]!) {
        least = right;
      }
      if (least === i) break;
      this.swap(i, least);
      i = least;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const item = this.items[a]!;
    const key = this.keys[a]!;
    this.items[a] = this.items[b]!;
    this.keys[a] = this.keys[b]!;
    this.items[b] = item;
    this.keys[b] = key;
  }
}
