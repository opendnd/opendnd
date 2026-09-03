import { CellId, MAX_LEVEL } from './cell-id';
import { LatLng, averageEdgeRadians } from './projection';

export const EARTH_RADIUS_METERS = 6_371_000;
export const FOOT_IN_METERS = 0.3048;

export interface WorldGridOptions {
  /** The world's radius. Earth is 6,371,000 m. */
  readonly radiusMeters: number;
  /** Side of one battle-map square in feet. Fifth edition uses 5. */
  readonly squareFeet?: number;
  /** Squares along one side of a battle-map tile. Must be a power of two. */
  readonly tileSquares?: number;
}

/**
 * Ties the abstract quadtree to a particular world: which level is a
 * battle-map square for this radius, which level is a battle-map tile, and
 * how to address a square inside its tile.
 */
export class WorldGrid {
  readonly radiusMeters: number;
  readonly squareMeters: number;
  readonly tileSquares: number;
  /** The level whose average cell edge is closest to one square. */
  readonly squareLevel: number;
  /** The level of a battle-map tile: `tileSquares` squares on a side. */
  readonly tileLevel: number;

  constructor(options: WorldGridOptions) {
    const tileSquares = options.tileSquares ?? 64;
    if (tileSquares < 1 || !Number.isInteger(Math.log2(tileSquares))) {
      throw new RangeError('tileSquares must be a power of two');
    }
    this.radiusMeters = options.radiusMeters;
    this.squareMeters = (options.squareFeet ?? 5) * FOOT_IN_METERS;
    this.tileSquares = tileSquares;
    this.squareLevel = levelForEdge(this.radiusMeters, this.squareMeters);
    this.tileLevel = this.squareLevel - Math.log2(tileSquares);
    if (this.tileLevel < 0) {
      throw new RangeError(
        'World is too small for a tile of that many squares',
      );
    }
  }

  /** Average edge of a cell at `level` on this world, in metres. */
  edgeMeters(level: number): number {
    return averageEdgeRadians(level) * this.radiusMeters;
  }

  /** The battle-map square under a point. */
  squareAt(ll: LatLng): CellId {
    return CellId.fromLatLng(ll, this.squareLevel);
  }

  /** The battle-map tile under a point. */
  tileAt(ll: LatLng): CellId {
    return CellId.fromLatLng(ll, this.tileLevel);
  }

  /** The tile a square belongs to. */
  tileOf(square: CellId): CellId {
    if (square.level() !== this.squareLevel) {
      throw new RangeError(`Expected a level ${this.squareLevel} square`);
    }
    return square.parent(this.tileLevel);
  }

  /** Local (x, y) of a square inside its tile, 0..tileSquares-1. */
  squareInTile(square: CellId): { tile: CellId; x: number; y: number } {
    const tile = this.tileOf(square);
    const [ti, tj] = tile.ij();
    const [si, sj] = square.ij();
    const scale = this.tileSquares;
    return { tile, x: si - ti * scale, y: sj - tj * scale };
  }

  /** The square at local (x, y) inside a tile. */
  squareOf(tile: CellId, x: number, y: number): CellId {
    if (tile.level() !== this.tileLevel) {
      throw new RangeError(`Expected a level ${this.tileLevel} tile`);
    }
    const n = this.tileSquares;
    if (x < 0 || y < 0 || x >= n || y >= n) {
      throw new RangeError(`(${x}, ${y}) is outside a ${n}x${n} tile`);
    }
    const [ti, tj] = tile.ij();
    return CellId.fromFaceIJ(
      tile.face(),
      ti * n + x,
      tj * n + y,
      this.squareLevel,
    );
  }
}

/** The level whose average cell edge is closest to `edgeMeters` on a world of the given radius. */
export function levelForEdge(radiusMeters: number, edgeMeters: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const diff = Math.abs(
      Math.log(averageEdgeRadians(level) * radiusMeters) - Math.log(edgeMeters),
    );
    if (diff < bestDiff) {
      best = level;
      bestDiff = diff;
    }
  }
  return best;
}
