/* eslint-disable no-bitwise -- a cell id is a bit layout; shifting and masking are the point */
import {
  FaceUV,
  LatLng,
  Point3,
  faceUVToPoint,
  latLngToPoint,
  normalize,
  pointToFace,
  pointToFaceUV,
  pointToFaceUVAuto,
  pointToLatLng,
  stToUV,
  uvToST,
} from './projection';

/** Finest level: on an Earth-sized world a leaf is under a centimetre. */
export const MAX_LEVEL = 30;
const POS_BITS = 2 * MAX_LEVEL; // 60
const FACE_BITS = 3;
const MAX_SIZE = 1 << MAX_LEVEL; // cells per face edge at MAX_LEVEL

/**
 * A cell of the cube-sphere quadtree, identified by a 64-bit id laid out as
 * S2 does: 3 face bits, 60 position bits (two per level, interleaved i and j)
 * and a trailing 1 that marks the level. Ids of a cell's descendants form a
 * contiguous range, so containment is a range check and sort order groups
 * nearby cells together.
 *
 * Position bits use plain i/j interleaving (Z-order) rather than S2's Hilbert
 * curve, so tokens are not byte-identical to S2's for the same cell; the
 * layout, arithmetic and level semantics are the same.
 */
export class CellId {
  /** From a face and the (i, j) cell coordinates at a level. */
  static fromFaceIJ(face: number, i: number, j: number, level: number): CellId {
    checkLevel(level);
    const n = 1 << level;
    if (face < 0 || face > 5 || i < 0 || i >= n || j < 0 || j >= n) {
      throw new RangeError(
        `Cell (face ${face}, i ${i}, j ${j}) is outside level ${level}`,
      );
    }
    const shift = MAX_LEVEL - level;
    const pos = interleave(
      BigInt(i) << BigInt(shift),
      BigInt(j) << BigInt(shift),
    );
    const lsb = 1n << BigInt(2 * shift);
    return new CellId(
      (BigInt(face) << BigInt(POS_BITS + 1)) | (pos << 1n) | lsb,
    );
  }

  /** From a face and (u, v) in [-1, 1]. Flat worlds call this with one face. */
  static fromFaceUV(face: number, u: number, v: number, level: number): CellId {
    const n = 1 << level;
    const i = clampIndex(Math.floor(uvToST(u) * n), n);
    const j = clampIndex(Math.floor(uvToST(v) * n), n);
    return CellId.fromFaceIJ(face, i, j, level);
  }

  static fromPoint(p: Point3, level: number): CellId {
    const { face, u, v } = pointToFaceUVAuto(p);
    return CellId.fromFaceUV(face, u, v, level);
  }

  static fromLatLng(ll: LatLng, level: number): CellId {
    return CellId.fromPoint(latLngToPoint(ll), level);
  }

  /** From a hex token (the id with trailing zero nibbles removed). */
  static fromToken(token: string): CellId {
    if (!/^[0-9a-f]{1,16}$/i.test(token)) {
      throw new SyntaxError(`Bad cell token "${token}"`);
    }
    return new CellId(BigInt(`0x${token.padEnd(16, '0')}`));
  }

  constructor(readonly id: bigint) {
    if (id <= 0n || id >= 1n << 64n) {
      throw new RangeError(`Invalid cell id ${id}`);
    }
    // The level marker is the lowest set bit; it must sit on an even bit.
    if (trailingZeros(id) % 2 !== 0) {
      throw new RangeError(`Cell id ${id} has no valid level marker`);
    }
  }

  /** Hex token, the id with trailing zero nibbles removed. */
  token(): string {
    return this.id.toString(16).padStart(16, '0').replace(/0+$/, '');
  }

  face(): number {
    return Number(this.id >> BigInt(POS_BITS + 1));
  }

  level(): number {
    return MAX_LEVEL - trailingZeros(this.id) / 2;
  }

  isLeaf(): boolean {
    return (this.id & 1n) === 1n;
  }

  /** The lowest set bit: 1 << 2*(MAX_LEVEL - level). */
  lsb(): bigint {
    return this.id & -this.id;
  }

  /** Smallest and largest leaf ids inside this cell. */
  rangeMin(): bigint {
    return this.id - (this.lsb() - 1n);
  }

  rangeMax(): bigint {
    return this.id + (this.lsb() - 1n);
  }

  contains(other: CellId): boolean {
    return other.id >= this.rangeMin() && other.id <= this.rangeMax();
  }

  intersects(other: CellId): boolean {
    return (
      other.rangeMin() <= this.rangeMax() && other.rangeMax() >= this.rangeMin()
    );
  }

  /** The ancestor at `level` (default: one level up). */
  parent(level?: number): CellId {
    const target = level ?? this.level() - 1;
    if (target < 0 || target >= this.level()) {
      throw new RangeError(
        `No parent at level ${target} for a level ${this.level()} cell`,
      );
    }
    const lsb = 1n << BigInt(2 * (MAX_LEVEL - target));
    return new CellId((this.id & -lsb) | lsb);
  }

  /** The four children, in position order. */
  children(): [CellId, CellId, CellId, CellId] {
    if (this.isLeaf()) throw new RangeError('A leaf cell has no children');
    const lsb = this.lsb();
    const childLsb = lsb >> 2n;
    const base = this.id - lsb + childLsb;
    return [
      new CellId(base),
      new CellId(base + 2n * childLsb),
      new CellId(base + 4n * childLsb),
      new CellId(base + 6n * childLsb),
    ];
  }

  /** (i, j) of this cell at its own level. */
  ij(): [number, number] {
    const shift = MAX_LEVEL - this.level();
    const pos = (this.id >> 1n) & ((1n << BigInt(POS_BITS)) - 1n);
    const [li, lj] = deinterleave(pos);
    return [Number(li >> BigInt(shift)), Number(lj >> BigInt(shift))];
  }

  /** Face and (u, v) of the cell centre. */
  centerUV(): FaceUV {
    const level = this.level();
    const n = 1 << level;
    const [i, j] = this.ij();
    return {
      face: this.face(),
      u: stToUV((i + 0.5) / n),
      v: stToUV((j + 0.5) / n),
    };
  }

  center(): Point3 {
    const { face, u, v } = this.centerUV();
    return normalize(faceUVToPoint(face, u, v));
  }

  centerLatLng(): LatLng {
    return pointToLatLng(this.center());
  }

  /**
   * The four edge neighbours at this level, wrapping across cube faces. A
   * level-0 face has the four faces around it.
   */
  neighbors(): CellId[] {
    const level = this.level();
    const [i, j] = this.ij();
    const face = this.face();
    return [
      fromFaceIJWrap(face, i, j - 1, level),
      fromFaceIJWrap(face, i + 1, j, level),
      fromFaceIJWrap(face, i, j + 1, level),
      fromFaceIJWrap(face, i - 1, j, level),
    ];
  }

  equals(other: CellId): boolean {
    return this.id === other.id;
  }

  toString(): string {
    return `${this.face()}/${this.level()}/${this.token()}`;
  }
}

/**
 * Like fromFaceIJ, but (i, j) may be one step outside the face; the cell is
 * then found on the adjacent face by going through 3-D space.
 */
export function fromFaceIJWrap(
  face: number,
  i: number,
  j: number,
  level: number,
): CellId {
  const n = 1 << level;
  if (i >= 0 && i < n && j >= 0 && j < n) {
    return CellId.fromFaceIJ(face, i, j, level);
  }
  // Linear (not quadratic) mapping in both directions keeps this consistent.
  const u = (2 * (i + 0.5)) / n - 1;
  const v = (2 * (j + 0.5)) / n - 1;
  const p = faceUVToPoint(face, u, v);
  const newFace = pointToFace(p);
  const [nu, nv] = pointToFaceUV(newFace, p);
  const ni = clampIndex(Math.floor(((nu + 1) / 2) * n), n);
  const nj = clampIndex(Math.floor(((nv + 1) / 2) * n), n);
  return CellId.fromFaceIJ(newFace, ni, nj, level);
}

function checkLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new RangeError(
      `Level must be an integer in 0..${MAX_LEVEL}, got ${level}`,
    );
  }
}

function clampIndex(i: number, n: number): number {
  return Math.min(Math.max(i, 0), n - 1);
}

function trailingZeros(x: bigint): number {
  let count = 0;
  while ((x & 1n) === 0n) {
    x >>= 1n;
    count++;
  }
  return count;
}

/** Interleave two 30-bit values: i in even bits, j in odd bits. */
function interleave(i: bigint, j: bigint): bigint {
  let out = 0n;
  for (let b = 0; b < MAX_LEVEL; b++) {
    const bit = BigInt(b);
    out |= ((i >> bit) & 1n) << (2n * bit);
    out |= ((j >> bit) & 1n) << (2n * bit + 1n);
  }
  return out;
}

function deinterleave(pos: bigint): [bigint, bigint] {
  let i = 0n;
  let j = 0n;
  for (let b = 0; b < MAX_LEVEL; b++) {
    const bit = BigInt(b);
    i |= ((pos >> (2n * bit)) & 1n) << bit;
    j |= ((pos >> (2n * bit + 1n)) & 1n) << bit;
  }
  return [i, j];
}

export { MAX_SIZE, FACE_BITS };
