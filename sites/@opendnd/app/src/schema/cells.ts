/* eslint-disable no-bitwise -- a cell id is a bit layout; shifting and masking are the point */
import type { Ontology } from './openapi';

/**
 * Quadtree cell tokens, as the ontology's `Cell` defines them: a 64-bit id
 * in hex with trailing zeros removed, laid out as three face bits, two
 * position bits per level and a trailing one that marks the level. This is
 * enough of the arithmetic to draw cells on a face, so a page need not carry
 * the spatial package.
 */
export const CELL_PATTERN = '^[0-9a-f]{1,16}$';

const MAX_LEVEL = 30;
const POS_BITS = 60n;

export interface Cell {
  readonly token: string;
  readonly face: number;
  readonly level: number;
  /** Column and row at the cell's own level. */
  readonly i: number;
  readonly j: number;
}

/** A cell from its token, or nothing for text that is not one. */
export function parseCell(token: unknown): Cell | undefined {
  if (typeof token !== 'string' || !/^[0-9a-f]{1,16}$/i.test(token)) {
    return undefined;
  }
  const id = BigInt(`0x${token.padEnd(16, '0')}`);
  if (id === 0n) return undefined;
  let zeros = 0;
  for (let x = id; (x & 1n) === 0n; x >>= 1n) zeros++;
  if (zeros % 2 !== 0) return undefined;
  const level = MAX_LEVEL - zeros / 2;
  const face = Number(id >> (POS_BITS + 1n));
  if (face > 5) return undefined;
  const pos = (id >> 1n) & ((1n << POS_BITS) - 1n);
  let i = 0n;
  let j = 0n;
  for (let b = 0n; b < 30n; b++) {
    i |= ((pos >> (2n * b)) & 1n) << b;
    j |= ((pos >> (2n * b + 1n)) & 1n) << b;
  }
  const shift = BigInt(MAX_LEVEL - level);
  return {
    token: token.toLowerCase(),
    face,
    level,
    i: Number(i >> shift),
    j: Number(j >> shift),
  };
}

/** The cell at (face, i, j, level), by its token. */
export function cellAt(
  face: number,
  i: number,
  j: number,
  level: number,
): Cell {
  const shift = BigInt(MAX_LEVEL - level);
  let pos = 0n;
  const bi = BigInt(i) << shift;
  const bj = BigInt(j) << shift;
  for (let b = 0n; b < 30n; b++) {
    pos |= ((bi >> b) & 1n) << (2n * b);
    pos |= ((bj >> b) & 1n) << (2n * b + 1n);
  }
  const id =
    (BigInt(face) << (POS_BITS + 1n)) | (pos << 1n) | (1n << (2n * shift));
  const token = id.toString(16).padStart(16, '0').replace(/0+$/, '');
  return { token, face, level, i, j };
}

/** Whether `inner` lies inside `outer`, itself included. */
export function contains(outer: Cell, inner: Cell): boolean {
  if (outer.face !== inner.face || inner.level < outer.level) return false;
  const span = 2 ** (inner.level - outer.level);
  return (
    Math.floor(inner.i / span) === outer.i &&
    Math.floor(inner.j / span) === outer.j
  );
}

/** The ancestor of a cell at a coarser level; nothing above the face. */
export function ancestor(cell: Cell, level: number): Cell | undefined {
  if (level < 0 || level > cell.level) return undefined;
  const span = 2 ** (cell.level - level);
  return cellAt(
    cell.face,
    Math.floor(cell.i / span),
    Math.floor(cell.j / span),
    level,
  );
}

/**
 * Where a cell sits inside a focus cell, in fractions of the focus's side:
 * the square to draw it as. Nothing for a cell on another face.
 */
export function placeWithin(
  focus: Cell,
  cell: Cell,
): { x: number; y: number; size: number } | undefined {
  if (cell.face !== focus.face) return undefined;
  const scale = 2 ** (cell.level - focus.level);
  return {
    x: cell.i / scale - focus.i,
    y: cell.j / scale - focus.j,
    size: 1 / scale,
  };
}

/**
 * The smallest cell holding every cell on the face most of them share, so a
 * map with nothing chosen shows as much as one face can. Nothing for no
 * cells.
 */
export function commonAncestor(cells: readonly Cell[]): Cell | undefined {
  if (cells.length === 0) return undefined;
  const byFace = new Map<number, number>();
  for (const cell of cells) {
    byFace.set(cell.face, (byFace.get(cell.face) ?? 0) + 1);
  }
  const face = [...byFace.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const onFace = cells.filter((cell) => cell.face === face);
  let level = Math.min(...onFace.map((cell) => cell.level));
  for (;;) {
    const candidate = ancestor(onFace[0]!, level)!;
    if (onFace.every((cell) => contains(candidate, cell))) return candidate;
    level--;
  }
}

/** The models whose records sit on the map: those with a cell field at their top, and its name. */
export function cellModels(
  ontology: Ontology,
): { model: string; field: string }[] {
  const found: { model: string; field: string }[] = [];
  for (const info of ontology.models) {
    const schema = ontology.schema(info.id);
    for (const [name, property] of Object.entries(schema?.properties ?? {})) {
      const resolved = ontology.resolve(property);
      if (resolved.pattern === CELL_PATTERN) {
        found.push({ model: info.id, field: name });
        break;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Where cells lie on the world: the cube-sphere projection the tokens are laid
// out on, enough of it to put a cell on a map drawn in latitude and longitude
// and to find the cell under a point on one.

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

type Point = readonly [number, number, number];

const DEG = Math.PI / 180;

/** Quadratic s -> u: evens out cell sizes across a face. */
function stToUV(s: number): number {
  return s >= 0.5
    ? (1 / 3) * (4 * s * s - 1)
    : (1 / 3) * (1 - 4 * (1 - s) * (1 - s));
}

function uvToST(u: number): number {
  return u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u);
}

function faceUVToPoint(face: number, u: number, v: number): Point {
  switch (face) {
    case 0:
      return [1, u, v];
    case 1:
      return [-u, 1, v];
    case 2:
      return [-u, -v, 1];
    case 3:
      return [-1, -v, -u];
    case 4:
      return [v, -1, -u];
    default:
      return [v, u, -1];
  }
}

function pointToLatLng([x, y, z]: Point): LatLng {
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / DEG,
    lng: Math.atan2(y, x) / DEG,
  };
}

function latLngToPoint({ lat, lng }: LatLng): Point {
  const cos = Math.cos(lat * DEG);
  return [
    cos * Math.cos(lng * DEG),
    cos * Math.sin(lng * DEG),
    Math.sin(lat * DEG),
  ];
}

function pointToFace([x, y, z]: Point): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face = ax > ay ? (ax > az ? 0 : 2) : ay > az ? 1 : 2;
  const component = face === 0 ? x : face === 1 ? y : z;
  if (component < 0) face += 3;
  return face;
}

function pointToFaceUV(face: number, [x, y, z]: Point): [number, number] {
  switch (face) {
    case 0:
      return [y / x, z / x];
    case 1:
      return [-x / y, z / y];
    case 2:
      return [-x / z, -y / z];
    case 3:
      return [z / x, y / x];
    case 4:
      return [z / y, -x / y];
    default:
      return [-y / z, -x / z];
  }
}

/** The point on the sphere at (s, t) within a cell, each in [0, 1] across it. */
function within(cell: Cell, s: number, t: number): LatLng {
  const n = 2 ** cell.level;
  return pointToLatLng(
    faceUVToPoint(
      cell.face,
      stToUV((cell.i + s) / n),
      stToUV((cell.j + t) / n),
    ),
  );
}

/** The centre of a cell. */
export function centerOf(cell: Cell): LatLng {
  return within(cell, 0.5, 0.5);
}

/**
 * A cell's outline as points around it, several to an edge because a cell's
 * edges are curves on a map drawn in latitude and longitude. Nothing for a
 * cell that reaches around a pole, which no such map can outline.
 */
export function outlineOf(cell: Cell, perEdge = 6): LatLng[] | undefined {
  const points: LatLng[] = [];
  for (let k = 0; k < perEdge; k++) points.push(within(cell, k / perEdge, 0));
  for (let k = 0; k < perEdge; k++) points.push(within(cell, 1, k / perEdge));
  for (let k = 0; k < perEdge; k++) {
    points.push(within(cell, 1 - k / perEdge, 1));
  }
  for (let k = 0; k < perEdge; k++) {
    points.push(within(cell, 0, 1 - k / perEdge));
  }
  // Keep the longitudes continuous across the antimeridian.
  const first = points[0]!.lng;
  const fixed = points.map((p) => {
    let lng = p.lng;
    while (lng - first > 180) lng -= 360;
    while (first - lng > 180) lng += 360;
    return { lat: p.lat, lng };
  });
  const lngs = fixed.map((p) => p.lng);
  if (Math.max(...lngs) - Math.min(...lngs) > 180) return undefined;
  return fixed;
}

/** The cell at a level under a point on the world. */
export function cellAtLatLng(at: LatLng, level: number): Cell {
  const point = latLngToPoint(at);
  const face = pointToFace(point);
  const [u, v] = pointToFaceUV(face, point);
  const n = 2 ** level;
  const clamp = (index: number) => Math.min(Math.max(index, 0), n - 1);
  return cellAt(
    face,
    clamp(Math.floor(uvToST(u) * n)),
    clamp(Math.floor(uvToST(v) * n)),
    level,
  );
}

/**
 * A cell two levels below a map's zoom is about the size of one of its tiles,
 * so this zoom shows a cell of the level filling most of the view.
 */
export function zoomFor(level: number): number {
  return Math.max(0, level + 3);
}

export interface View {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
  readonly zoom: number;
}

export interface Coverage {
  /** The cells to ask for what is inside, each as its token. */
  readonly cells: string[];
  /** The faces those cells lie on, to ask for what is coarser than they are. */
  readonly faces: string[];
  readonly sampleLevel: number;
  /** The finest level worth drawing at this zoom. */
  readonly maxLevel: number;
}

/**
 * Which cells a view of the map is fetched by: the view is sampled on a grid
 * and the distinct cells under the samples are asked for, at a level coarse
 * enough that there are few of them, down to the finest level worth drawing
 * at the zoom. Everything coarser than the sample cells is asked of their
 * faces instead, since a kingdom is not inside a county.
 */
export function coverage(
  view: View,
  options: {
    readonly grid?: number;
    readonly most?: number;
    readonly below?: number;
  } = {},
): Coverage {
  const grid = options.grid ?? 4;
  const most = options.most ?? 8;
  const zoom = Math.round(view.zoom);
  const maxLevel = Math.min(30, Math.max(1, zoom + (options.below ?? 4)));
  const north = Math.min(view.north, 85);
  const south = Math.max(view.south, -85);
  let west = view.west;
  let east = view.east;
  if (east - west >= 360) {
    west = -180;
    east = 180;
  }
  const points: LatLng[] = [];
  for (let row = 0; row <= grid; row++) {
    for (let col = 0; col <= grid; col++) {
      let lng = west + ((east - west) * col) / grid;
      lng = ((((lng + 180) % 360) + 360) % 360) - 180;
      points.push({ lat: south + ((north - south) * row) / grid, lng });
    }
  }
  let sampleLevel = Math.max(0, zoom - 2);
  for (;;) {
    const cells = [
      ...new Set(points.map((p) => cellAtLatLng(p, sampleLevel).token)),
    ];
    if (cells.length <= most || sampleLevel === 0) {
      const faces = [
        ...new Set(cells.map((t) => ancestor(parseCell(t)!, 0)!.token)),
      ];
      return { cells, faces, sampleLevel, maxLevel };
    }
    sampleLevel--;
  }
}
