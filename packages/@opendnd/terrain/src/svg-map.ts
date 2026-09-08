import {
  type Point,
  type Ring,
  boundsOf,
  ringsOf,
  signedArea,
} from './path-data';

/**
 * Reading the shapes out of a map somebody drew.
 *
 * Plenty of worlds already exist as a drawing: a coastline and a set of
 * borders in a vector tool, exported as SVG. That drawing holds more than a
 * picture of it ever can — every coast is an exact curve rather than a run of
 * pixels to be guessed at — so it is read as data rather than traced.
 *
 * What is read is deliberately little: the shapes, whether each is land or
 * water, and which group of the drawing it came from. Colours are ignored,
 * because a drawing reuses a small palette across many shapes and so a colour
 * says nothing about which shape it is.
 */

/** Whether a shape is ground or something wet sitting on it. */
export type ShapeKind = 'land' | 'water';

export interface MapShape {
  /** The layer it was drawn on: a continent, usually. */
  readonly group: string;
  readonly kind: ShapeKind;
  /** The outline, and any holes in it, in the drawing's own units. */
  readonly rings: readonly Ring[];
  /** `[minX, minY, maxX, maxY]`, for deciding quickly what a point cannot be in. */
  readonly bounds: readonly [number, number, number, number];
  /** Area in square drawing units, which orders continents before islands. */
  readonly area: number;
}

export interface DrawnMap {
  /** The drawing's own extent, from its `viewBox` or its width and height. */
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly MapShape[];
  /** The groups the shapes came from, in the order they were drawn. */
  readonly groups: readonly string[];
}

export interface ReadOptions {
  /**
   * How a group or a shape is known to be water. Matched against the `id` of
   * the shape and of every group above it, without regard to case.
   *
   * A drawing that says which layer is water is telling us where its lakes
   * and inland seas are, and that is worth having: a lake is a hole in the
   * land, not a hole in the world, and the two behave differently once there
   * is height under them.
   */
  readonly water?: RegExp;
  /** How far a flattened curve may stray from the curve it replaces. */
  readonly flatness?: number;
  /** Shapes smaller than this many square drawing units are dropped. */
  readonly smallest?: number;
}

const WATER = /water|lake|sea|ocean|river/i;

/**
 * The shapes of a drawn map.
 *
 * The parsing here is deliberately shallow: elements, their `id`, and the `d`
 * of every path. A drawing tool's export is machine-written and regular, and
 * a full parser would buy nothing but a dependency.
 */
export function readDrawnMap(svg: string, options: ReadOptions = {}): DrawnMap {
  const water = options.water ?? WATER;
  const smallest = options.smallest ?? 0;
  const { width, height } = extentOf(svg);

  const shapes: MapShape[] = [];
  const groups: string[] = [];
  // The `id` of every group we are inside, outermost first.
  const open: string[] = [];
  // What every group above has done to the coordinates, multiplied together.
  const placings: Matrix[] = [IDENTITY];

  for (const tag of tags(svg)) {
    if (tag.name === 'g') {
      if (tag.closing) {
        open.pop();
        if (placings.length > 1) placings.pop();
      } else if (!tag.selfClosing) {
        const id = tag.attributes.id ?? '';
        open.push(id);
        if (id !== '' && !groups.includes(id)) groups.push(id);
        placings.push(
          times(
            placings[placings.length - 1]!,
            matrixOf(tag.attributes.transform),
          ),
        );
      }
      continue;
    }
    if (tag.name !== 'path' || tag.closing) continue;
    const d = tag.attributes.d;
    if (d === undefined || d === '') continue;

    // Where the shape ends up: what the groups above it do, then its own.
    const placing = times(
      placings[placings.length - 1]!,
      matrixOf(tag.attributes.transform),
    );
    const rings = ringsOf(d, options.flatness).map((ring) =>
      place(placing, ring),
    );
    if (rings.length === 0) continue;
    const area = rings.reduce(
      (sum, ring) => sum + Math.abs(signedArea(ring)) / 2,
      0,
    );
    if (area < smallest) continue;

    const own = tag.attributes.id ?? '';
    const wet = water.test(own) || open.some((id) => water.test(id));
    shapes.push({
      // The nearest named group that is not the water layer itself: a lake
      // belongs to the continent it sits in, not to a layer called Water.
      group:
        [...open].reverse().find((id) => id !== '' && !water.test(id)) ?? '',
      kind: wet ? 'water' : 'land',
      rings,
      bounds: boundsOf(rings),
      area,
    });
  }

  return { width, height, shapes, groups };
}

/** The drawing's coordinate extent. */
function extentOf(svg: string): { width: number; height: number } {
  const box = /viewBox\s*=\s*"([^"]+)"/i.exec(svg)?.[1];
  if (box) {
    const parts = box
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  const width = Number(/\bwidth\s*=\s*"([\d.]+)/i.exec(svg)?.[1]);
  const height = Number(/\bheight\s*=\s*"([\d.]+)/i.exec(svg)?.[1]);
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height };
  }
  throw new Error('the drawing says neither a viewBox nor a size');
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: Record<string, string>;
}

/** Every element open, close or empty, in the order it appears. */
function* tags(svg: string): Generator<Tag> {
  const pattern =
    /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let match;
  while ((match = pattern.exec(svg)) !== null) {
    yield {
      name: match[2]!.toLowerCase(),
      closing: match[1] === '/',
      selfClosing: match[4] === '/',
      attributes: attributesIn(match[3] ?? ''),
    };
  }
}

function attributesIn(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  const pattern =
    /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][\w:.-]*)\s*=\s*'([^']*)'/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    found[(match[1] ?? match[3])!] = (match[2] ?? match[4])!;
  }
  return found;
}

/**
 * A drawing tool places its layers rather than moving their coordinates, so a
 * shape's numbers mean nothing until everything above it has had its say. The
 * six numbers are the usual `a b c d e f`: `x' = ax + cy + e`, `y' = bx + dy + f`.
 */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function times(outer: Matrix, inner: Matrix): Matrix {
  if (inner === IDENTITY) return outer;
  if (outer === IDENTITY) return inner;
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

function place(matrix: Matrix, ring: Ring): Ring {
  if (matrix === IDENTITY) return ring;
  const [a, b, c, d, e, f] = matrix;
  return ring.map(([x, y]): Point => [a * x + c * y + e, b * x + d * y + f]);
}

/** The `transform` of an element, as one matrix. */
export function matrixOf(transform: string | undefined): Matrix {
  if (transform === undefined || transform.trim() === '') return IDENTITY;
  let out: Matrix = IDENTITY;
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(transform)) !== null) {
    const numbers = (match[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    out = times(out, oneOf(match[1]!.toLowerCase(), numbers));
  }
  return out;
}

function oneOf(name: string, n: number[]): Matrix {
  switch (name) {
    case 'translate':
      return [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    case 'scale':
      return [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    case 'matrix':
      return n.length === 6 ? (n as unknown as Matrix) : IDENTITY;
    case 'rotate': {
      const radians = ((n[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const spin: Matrix = [cos, sin, -sin, cos, 0, 0];
      if (n.length < 3) return spin;
      // About a point: there and back again around the turn.
      const [, x = 0, y = 0] = n;
      return times(times([1, 0, 0, 1, x, y], spin), [1, 0, 0, 1, -x, -y]);
    }
    case 'skewx':
      return [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    case 'skewy':
      return [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    default:
      return IDENTITY;
  }
}

/**
 * The same drawing with some of its layers moved.
 *
 * A drawing is edited after it is published: a continent gets nudged, or
 * redrawn at a different size, and the pictures already made from it stay as
 * they were. Rather than choose between the drawing and the pictures, each
 * layer is placed where the pictures say it is, and the drawing becomes what
 * the pictures were made from.
 *
 * Only groups named here move; everything else is left alone.
 */
export function placeGroups(
  map: DrawnMap,
  placings: Readonly<Record<string, Matrix>>,
): DrawnMap {
  const shapes = map.shapes.map((shape) => {
    const matrix = placings[shape.group];
    if (matrix === undefined) return shape;
    const rings = shape.rings.map((ring) => place(matrix, ring as Ring));
    return {
      ...shape,
      rings,
      bounds: boundsOf(rings),
      area: rings.reduce(
        (sum, ring) => sum + Math.abs(signedArea(ring)) / 2,
        0,
      ),
    };
  });
  return { ...map, shapes };
}

/**
 * The matrix that puts a box of the drawing over the whole of a square.
 *
 * How a layer's placing is written down once it has been solved for: the part
 * of the drawing the pictures show as the whole world, stretched to be it.
 */
export function boxToWhole(
  box: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): Matrix {
  const x = width / box.width;
  const y = height / box.height;
  return [x, 0, 0, y, -box.left * x, -box.top * y];
}
