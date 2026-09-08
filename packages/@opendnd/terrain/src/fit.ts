import type { Point, Ring } from './path-data';

/**
 * Putting a drawing on a globe.
 *
 * A drawing has no idea where on a world it is; it is a rectangle of made-up
 * units. What turns it into geography is one decision: which part of the
 * drawing is the whole world. Everything else follows, because a world map
 * is served as tiles in the web map projection, and that projection covers
 * the world in one square.
 *
 * The decision is written down rather than assumed, so a drawing that was
 * padded or cropped before it was tiled can be lined back up.
 */

/** How far from the equator the web map projection reaches, in degrees. */
export const MERCATOR_LIMIT = 85.05112877980659;

/**
 * How a drawing's vertical runs.
 *
 * `mercator` means the drawing is already in the square a web map is served
 * in, which is what a drawing that has been tiled is: its top edge is as far
 * north as a web map goes, not the pole. `equirectangular` is what somebody
 * drawing a world by hand without tiling it usually means, latitude straight
 * down the page from pole to pole. The difference is not small — a drawing
 * read as the wrong one puts its poles in the wrong hemisphere's worth of the
 * map — so it is said rather than guessed, and the default is the one a
 * drawing arrives in when it arrives with pictures.
 */
export type Vertical = 'equirectangular' | 'mercator';

export interface MapFit {
  /** The drawing coordinate at the world's western edge. */
  readonly left: number;
  /** The drawing coordinate at the world's northern edge. */
  readonly top: number;
  /** How many drawing units the world spans east to west. */
  readonly span: number;
  /** How many it spans north to south. Square unless the drawing is not. */
  readonly height: number;
  readonly vertical: Vertical;
}

/**
 * The obvious fit: the drawing is the world, corner to corner.
 *
 * A square drawing exported for tiling is usually exactly this, because the
 * tiler wants a square covering the world and the artist drew one.
 */
export function wholeDrawing(
  width: number,
  height: number,
  vertical: Vertical = 'mercator',
): MapFit {
  return { left: 0, top: 0, span: width, height, vertical };
}

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Where a point of the drawing is on the world. */
export function toLatLng(fit: MapFit, point: Point): LatLng {
  const u = (point[0] - fit.left) / fit.span;
  const v = (point[1] - fit.top) / fit.height;
  return {
    lng: u * 360 - 180,
    lat: fit.vertical === 'mercator' ? latOf(v) : 90 - v * 180,
  };
}

/** Where a place on the world falls in the drawing. */
export function toDrawing(fit: MapFit, at: LatLng): Point {
  const u = (at.lng + 180) / 360;
  const v = fit.vertical === 'mercator' ? vOf(at.lat) : (90 - at.lat) / 180;
  return [fit.left + u * fit.span, fit.top + v * fit.height];
}

/** A ring of the drawing, on the world. */
export function ringToLatLng(fit: MapFit, ring: Ring): LatLng[] {
  return ring.map((point) => toLatLng(fit, point));
}

/**
 * The latitude at a fraction down the world square.
 *
 * The web map projection stretches towards the poles so that a small square
 * of the world stays a square on the map; this is the inverse of that
 * stretch, which is why a map of it can never quite reach a pole.
 */
export function latOf(v: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;
}

/** How far down the world square a latitude falls. */
export function vOf(lat: number): number {
  const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat));
  const radians = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI);
}

/** The tile a place falls in, at a zoom, and where in that tile it falls. */
export function tileAt(
  at: LatLng,
  zoom: number,
): { x: number; y: number; offsetX: number; offsetY: number } {
  const count = 2 ** zoom;
  const u = ((at.lng + 180) / 360) * count;
  const v = vOf(at.lat) * count;
  const x = Math.floor(u);
  const y = Math.floor(v);
  return { x, y, offsetX: u - x, offsetY: v - y };
}

/** The corners of a tile, as the world sees them. */
export function tileBounds(
  zoom: number,
  x: number,
  y: number,
): { north: number; south: number; west: number; east: number } {
  const count = 2 ** zoom;
  return {
    west: (x / count) * 360 - 180,
    east: ((x + 1) / count) * 360 - 180,
    north: latOf(y / count),
    south: latOf((y + 1) / count),
  };
}

/**
 * The part of the drawing one tile covers.
 *
 * Used to hold a reading of a drawing against the pictures made from it:
 * whatever a tile shows, the shapes falling in this box are what the drawing
 * says is there.
 */
export function tileInDrawing(
  fit: MapFit,
  zoom: number,
  x: number,
  y: number,
): { left: number; top: number; right: number; bottom: number } {
  const count = 2 ** zoom;
  const box = tileBounds(zoom, x, y);
  const [left, top] = toDrawing(fit, { lat: box.north, lng: box.west });
  const [right, bottom] = toDrawing(fit, { lat: box.south, lng: box.east });
  // A tile at the world's western edge is `count` tiles wide in longitude,
  // which the two corners give exactly; the vertical is not linear, so it
  // comes from the corners too rather than from a tile height.
  void count;
  return { left, top, right, bottom };
}
