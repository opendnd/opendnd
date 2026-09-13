import { CellId } from '@opendnd/spatial';
import type { LatLng } from './fit';

/**
 * Ground divided among the places that sit on it.
 *
 * A drawing of coastlines says where the land is, not who holds it. Three
 * countries on one island share one outline, and giving each of them the
 * island makes every one of them the answer to "where am I" — which is no
 * answer. Until somebody draws the borders, the honest division is the one
 * people on the ground use: land belongs to the seat it is nearest to. It is
 * disjoint by construction, because a cell has one nearest seat, and it is
 * the shape a border settles into anyway when nothing else decides it.
 *
 * A border drawn later replaces this. Nothing downstream can tell the
 * difference: either way a place holds a list of cells.
 */

export interface Seat {
  /** Whatever the caller wants back: an id, a name, an index. */
  readonly key: string;
  /** Where the place is seated — its capital, or where its name is written. */
  readonly at: LatLng;
}

export interface DivideOptions {
  /**
   * Refine cells that straddle the boundary between seats to this level.
   *
   * The ground away from a boundary stays coarse; only cells whose children,
   * neighbours, or seats disagree about the nearest seat are split. The
   * result therefore costs like the length of the border rather than the
   * area of the country.
   */
  readonly maxLevel?: number;
}

/** The cells of a piece of ground, shared out by which seat is nearest. */
export function divide(
  cells: readonly string[],
  seats: readonly Seat[],
  options: DivideOptions = {},
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const seat of seats) out[seat.key] = [];
  if (seats.length === 0) return out;
  if (seats.length === 1) {
    out[seats[0]!.key] = [...cells];
    return out;
  }
  const towards = seats.map((seat) => ({
    key: seat.key,
    point: unit(seat.at),
    cell:
      options.maxLevel === undefined
        ? undefined
        : CellId.fromLatLng(seat.at, options.maxLevel),
  }));
  const nearest = (middle: Vector) => {
    let best = towards[0]!;
    let closest = -2;
    for (const seat of towards) {
      // The dot product of two unit vectors falls as the angle between them
      // grows, so the largest is the nearest, with no trigonometry and no
      // square roots.
      const along =
        middle.x * seat.point.x +
        middle.y * seat.point.y +
        middle.z * seat.point.z;
      if (along > closest) {
        closest = along;
        best = seat;
      }
    }
    return best;
  };
  const give = (cell: CellId): void => {
    const holder = nearest(cell.center());
    const maxLevel = options.maxLevel;
    if (maxLevel === undefined || cell.level() >= maxLevel) {
      out[holder.key]!.push(cell.token());
      return;
    }
    const children = cell.children();
    const childHolders = children.map((child) => nearest(child.center()).key);
    const neighbourHolders = cell
      .neighbors()
      .map((neighbour) => nearest(neighbour.center()).key);
    const seatsInside = towards.filter(
      (seat) => seat.cell !== undefined && cell.contains(seat.cell),
    );
    const whole =
      childHolders.every((key) => key === holder.key) &&
      neighbourHolders.every((key) => key === holder.key) &&
      seatsInside.every((seat) => seat.key === holder.key);
    if (whole) {
      out[holder.key]!.push(cell.token());
      return;
    }
    for (const child of children) give(child);
  };
  for (const token of cells) {
    give(CellId.fromToken(token));
  }
  return out;
}

interface Vector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A place on the globe as a point on the unit sphere. */
function unit(at: LatLng): Vector {
  const lat = (at.lat * Math.PI) / 180;
  const lng = (at.lng * Math.PI) / 180;
  const flat = Math.cos(lat);
  return {
    x: flat * Math.cos(lng),
    y: flat * Math.sin(lng),
    z: Math.sin(lat),
  };
}
