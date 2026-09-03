/**
 * Cube-sphere projection, following the conventions of S2 so that ids and
 * tokens are interchangeable with S2 tooling.
 *
 * A point on the unit sphere maps to one of six cube faces and a (u, v)
 * position in [-1, 1] on that face. Cell coordinates use (s, t) in [0, 1],
 * related to (u, v) by a quadratic curve that evens out cell sizes: with it,
 * cell edge lengths at one level vary by at most about 1.8x and areas by
 * about 2.1x across the whole sphere, against 3x and 5x for a plain cube.
 */

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LatLng {
  /** Degrees, -90..90. */
  readonly lat: number;
  /** Degrees, -180..180. */
  readonly lng: number;
}

export interface FaceUV {
  readonly face: number;
  readonly u: number;
  readonly v: number;
}

const DEG = Math.PI / 180;

export function latLngToPoint({ lat, lng }: LatLng): Point3 {
  const phi = lat * DEG;
  const theta = lng * DEG;
  const cos = Math.cos(phi);
  return {
    x: cos * Math.cos(theta),
    y: cos * Math.sin(theta),
    z: Math.sin(phi),
  };
}

export function pointToLatLng(p: Point3): LatLng {
  return {
    lat: Math.atan2(p.z, Math.hypot(p.x, p.y)) / DEG,
    lng: Math.atan2(p.y, p.x) / DEG,
  };
}

export function normalize(p: Point3): Point3 {
  const n = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / n, y: p.y / n, z: p.z / n };
}

/** The cube face a direction falls on: 0..2 for +x, +y, +z; 3..5 for -x, -y, -z. */
export function pointToFace(p: Point3): number {
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);
  let face = ax > ay ? (ax > az ? 0 : 2) : ay > az ? 1 : 2;
  const component = face === 0 ? p.x : face === 1 ? p.y : p.z;
  if (component < 0) face += 3;
  return face;
}

/** (u, v) of a direction on a face it is known to fall on. */
export function pointToFaceUV(face: number, p: Point3): [number, number] {
  switch (face) {
    case 0:
      return [p.y / p.x, p.z / p.x];
    case 1:
      return [-p.x / p.y, p.z / p.y];
    case 2:
      return [-p.x / p.z, -p.y / p.z];
    case 3:
      return [p.z / p.x, p.y / p.x];
    case 4:
      return [p.z / p.y, -p.x / p.y];
    default:
      return [-p.y / p.z, -p.x / p.z];
  }
}

export function pointToFaceUVAuto(p: Point3): FaceUV {
  const face = pointToFace(p);
  const [u, v] = pointToFaceUV(face, p);
  return { face, u, v };
}

/** A direction (not normalized) from a face and (u, v). */
export function faceUVToPoint(face: number, u: number, v: number): Point3 {
  switch (face) {
    case 0:
      return { x: 1, y: u, z: v };
    case 1:
      return { x: -u, y: 1, z: v };
    case 2:
      return { x: -u, y: -v, z: 1 };
    case 3:
      return { x: -1, y: -v, z: -u };
    case 4:
      return { x: v, y: -1, z: -u };
    default:
      return { x: v, y: u, z: -1 };
  }
}

/** Quadratic s -> u (and t -> v). */
export function stToUV(s: number): number {
  return s >= 0.5
    ? (1 / 3) * (4 * s * s - 1)
    : (1 / 3) * (1 - 4 * (1 - s) * (1 - s));
}

/** Quadratic u -> s (and v -> t). */
export function uvToST(u: number): number {
  return u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u);
}

/**
 * Average edge length of a level-k cell, in radians on the unit sphere, for
 * the quadratic projection. Multiply by a world's radius for metres.
 */
export function averageEdgeRadians(level: number): number {
  return 1.459 / 2 ** level;
}
