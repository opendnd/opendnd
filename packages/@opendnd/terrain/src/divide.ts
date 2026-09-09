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

/** The cells of a piece of ground, shared out by which seat is nearest. */
export function divide(
  cells: readonly string[],
  seats: readonly Seat[],
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
  }));
  for (const token of cells) {
    const middle = unit(CellId.fromToken(token).centerLatLng());
    let nearest = towards[0]!;
    let closest = -2;
    for (const seat of towards) {
      // The dot product of two unit vectors falls as the angle between them
      // grows, so the largest is the nearest, with no trigonometry and no
      // square roots.
      const along =
        middle[0] * seat.point[0] +
        middle[1] * seat.point[1] +
        middle[2] * seat.point[2];
      if (along > closest) {
        closest = along;
        nearest = seat;
      }
    }
    out[nearest.key]!.push(token);
  }
  return out;
}

/** A place on the globe as a point on the unit sphere. */
function unit(at: LatLng): [number, number, number] {
  const lat = (at.lat * Math.PI) / 180;
  const lng = (at.lng * Math.PI) / 180;
  const flat = Math.cos(lat);
  return [flat * Math.cos(lng), flat * Math.sin(lng), Math.sin(lat)];
}
