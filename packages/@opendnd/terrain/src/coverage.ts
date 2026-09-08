import { type MapFit, tileInDrawing } from './fit';
import { type Ring, inRing } from './path-data';
import type { DrawnMap, MapShape } from './svg-map';

/**
 * How much of a square of the drawing is land.
 *
 * The one measurement that can be taken of both a drawing and a picture made
 * from it, which is what makes it the way to check that a drawing has been
 * put on the globe correctly: sample a square, ask the drawing what is under
 * each sample, ask the picture the same, and see whether the two agree.
 *
 * Sampled rather than integrated, because a coastline is a few thousand
 * points and the answer only has to be good enough to tell a right fit from
 * a wrong one.
 */
export function landFraction(
  map: DrawnMap,
  box: { left: number; top: number; right: number; bottom: number },
  samples = 16,
): number {
  let land = 0;
  for (let row = 0; row < samples; row += 1) {
    for (let column = 0; column < samples; column += 1) {
      const x = box.left + ((column + 0.5) / samples) * (box.right - box.left);
      const y = box.top + ((row + 0.5) / samples) * (box.bottom - box.top);
      if (isLand(map, [x, y])) land += 1;
    }
  }
  return land / (samples * samples);
}

/** The same, for one tile of the world at a zoom. */
export function tileLandFraction(
  map: DrawnMap,
  fit: MapFit,
  zoom: number,
  x: number,
  y: number,
  samples = 16,
): number {
  return landFraction(map, tileInDrawing(fit, zoom, x, y), samples);
}

/**
 * Whether a point of the drawing is on land.
 *
 * Later shapes are drawn over earlier ones, so the last shape a point falls
 * in is the one that decides: a lake drawn over a continent makes that point
 * water, and an island drawn in the lake makes it land again.
 */
export function isLand(
  map: DrawnMap,
  point: readonly [number, number],
): boolean {
  let land = false;
  for (const shape of map.shapes) {
    if (!within(shape, point)) continue;
    land = shape.kind === 'land';
  }
  return land;
}

/** The shapes a point falls in, in the order they were drawn. */
export function shapesAt(
  map: DrawnMap,
  point: readonly [number, number],
): MapShape[] {
  return map.shapes.filter((shape) => within(shape, point));
}

function within(shape: MapShape, point: readonly [number, number]): boolean {
  const [minX, minY, maxX, maxY] = shape.bounds;
  if (
    point[0] < minX ||
    point[0] > maxX ||
    point[1] < minY ||
    point[1] > maxY
  ) {
    return false;
  }
  // An odd number of rings means inside: the outline, less any hole in it.
  let inside = false;
  for (const ring of shape.rings) {
    if (inRing(ring as Ring, point as [number, number])) inside = !inside;
  }
  return inside;
}
