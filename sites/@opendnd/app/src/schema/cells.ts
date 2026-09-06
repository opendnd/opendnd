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
