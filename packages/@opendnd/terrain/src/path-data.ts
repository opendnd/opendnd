/**
 * Reading the `d` of an SVG path.
 *
 * Only what a drawing tool emits for a map: moves, lines, cubic and quadratic
 * curves, and closes, in both their absolute and relative spellings. Curves
 * are flattened as they are read, because everything downstream — what is
 * inside a shape, how long a coast is, which cells a country covers — is
 * asked of a ring of points, and a curve would have to be flattened to answer
 * any of it.
 */

export type Point = readonly [x: number, y: number];

/** A closed ring of points, in the coordinates the drawing was made in. */
export type Ring = readonly Point[];

/** How far a flattened curve may stray from the curve, in drawing units. */
export const FLATNESS = 0.35;

const COMMANDS = new Set('MmLlHhVvCcSsQqTtAaZz');

/**
 * The rings of one path.
 *
 * A path may hold several: a country with an island off its coast is one
 * path with two subpaths, and a subpath that was never closed is closed
 * here, because a shape on a map is an area whatever the drawing says.
 */
export function ringsOf(d: string, flatness = FLATNESS): Ring[] {
  const rings: Ring[] = [];
  let ring: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  // The control point a smooth curve reflects, when the last command curved.
  let lastControl: Point | undefined;

  const finish = (): void => {
    if (ring.length > 2) rings.push(ring);
    ring = [];
  };

  for (const [command, numbers] of commands(d)) {
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const step = ARITY[upper];
    if (step === undefined) continue;

    // A command may carry several sets of arguments, which repeat it; after
    // a move, the repeats are lines, as the specification says.
    let index = 0;
    do {
      const args = numbers.slice(index, index + step);
      if (step > 0 && args.length < step) break;
      const effective = upper === 'M' && index > 0 ? 'L' : upper;
      const to = (x: number, y: number): Point =>
        relative ? [at[0] + x, at[1] + y] : [x, y];

      switch (effective) {
        case 'M': {
          finish();
          at = to(args[0]!, args[1]!);
          start = at;
          ring = [at];
          lastControl = undefined;
          break;
        }
        case 'L': {
          at = to(args[0]!, args[1]!);
          ring.push(at);
          lastControl = undefined;
          break;
        }
        case 'H': {
          at = [relative ? at[0] + args[0]! : args[0]!, at[1]];
          ring.push(at);
          lastControl = undefined;
          break;
        }
        case 'V': {
          at = [at[0], relative ? at[1] + args[0]! : args[0]!];
          ring.push(at);
          lastControl = undefined;
          break;
        }
        case 'C':
        case 'S': {
          const first =
            effective === 'C'
              ? to(args[0]!, args[1]!)
              : reflect(at, lastControl);
          const rest = effective === 'C' ? 2 : 0;
          const second = to(args[rest]!, args[rest + 1]!);
          const end = to(args[rest + 2]!, args[rest + 3]!);
          cubic(ring, at, first, second, end, flatness);
          lastControl = second;
          at = end;
          break;
        }
        case 'Q':
        case 'T': {
          const control =
            effective === 'Q'
              ? to(args[0]!, args[1]!)
              : reflect(at, lastControl);
          const rest = effective === 'Q' ? 2 : 0;
          const end = to(args[rest]!, args[rest + 1]!);
          // A quadratic is the cubic with its controls two thirds of the way.
          cubic(
            ring,
            at,
            [
              at[0] + (2 / 3) * (control[0] - at[0]),
              at[1] + (2 / 3) * (control[1] - at[1]),
            ],
            [
              end[0] + (2 / 3) * (control[0] - end[0]),
              end[1] + (2 / 3) * (control[1] - end[1]),
            ],
            end,
            flatness,
          );
          lastControl = control;
          at = end;
          break;
        }
        case 'A': {
          // Arcs are not drawn on these maps. Treated as the line they span,
          // which is wrong by the bulge of the arc and right about the ends.
          at = to(args[5]!, args[6]!);
          ring.push(at);
          lastControl = undefined;
          break;
        }
        case 'Z': {
          finish();
          at = start;
          lastControl = undefined;
          break;
        }
        default:
          break;
      }
      index += step;
    } while (step > 0 && index < numbers.length);
  }
  finish();
  return rings;
}

/** How many numbers each command takes, per repeat. */
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** The commands of a `d`, each with its numbers. */
function* commands(d: string): Generator<[string, number[]]> {
  let at = 0;
  while (at < d.length) {
    const character = d[at]!;
    if (!COMMANDS.has(character)) {
      at += 1;
      continue;
    }
    let end = at + 1;
    while (end < d.length && !COMMANDS.has(d[end]!)) end += 1;
    yield [character, numbersIn(d.slice(at + 1, end))];
    at = end;
  }
}

/**
 * The numbers in a run of path arguments.
 *
 * Path data is written tightly: separators are optional wherever a number
 * cannot be continued, so `10-20` is two numbers and `.5.5` is two more.
 */
function numbersIn(text: string): number[] {
  const found: number[] = [];
  const pattern = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) found.push(Number(match[0]));
  return found;
}

/** The control point a smooth curve continues from: the last one, mirrored. */
function reflect(at: Point, last: Point | undefined): Point {
  if (!last) return at;
  return [2 * at[0] - last[0], 2 * at[1] - last[1]];
}

/**
 * A cubic curve as a run of points, subdivided until it is flat enough.
 *
 * How flat is decided from the curve itself rather than by a fixed count, so
 * a long sweeping coast and a tight inlet each get the points they need.
 */
function cubic(
  into: Point[],
  from: Point,
  first: Point,
  second: Point,
  to: Point,
  flatness: number,
): void {
  const steps = stepsFor(from, first, second, to, flatness);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    into.push([
      u * u * u * from[0] +
        3 * u * u * t * first[0] +
        3 * u * t * t * second[0] +
        t * t * t * to[0],
      u * u * u * from[1] +
        3 * u * u * t * first[1] +
        3 * u * t * t * second[1] +
        t * t * t * to[1],
    ]);
  }
}

function stepsFor(
  from: Point,
  first: Point,
  second: Point,
  to: Point,
  flatness: number,
): number {
  // The control net is at least as long as the curve, so its length bounds
  // how much subdividing the curve can possibly need.
  const net =
    distance(from, first) + distance(first, second) + distance(second, to);
  return Math.min(64, Math.max(1, Math.ceil(Math.sqrt(net / flatness))));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Twice the signed area of a ring: positive one way round, negative the other. */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/** The smallest box holding a ring: `[minX, minY, maxX, maxY]`. */
export function boundsOf(
  rings: readonly Ring[],
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Whether a point is inside a ring, by casting a ray and counting crossings. */
export function inRing(ring: Ring, point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}
