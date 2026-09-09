import type { Noise } from './noise';
import { type Outline, type Point, type Segment, flatten } from './path-data';

/**
 * Coastline below the depth anybody drew.
 *
 * A drawn map runs out. One tiled for the web usually stops around the width
 * of a county: zoom past that and the coast becomes the smooth curve somebody
 * drew with a mouse, which is not what a coast looks like from a boat. Real coastline is rough at
 * every scale — that is the whole point of it being fractal — so below the
 * depth the drawing supports, the missing roughness is generated.
 *
 * It is generated *from the coast itself* rather than added on top: the
 * displacement of a point depends on where that point is, so the same stretch
 * of coast is the same shape every time it is drawn, at every zoom, from any
 * machine. A coast that shimmered as you zoomed would be worse than a smooth
 * one.
 */

export interface DetailOptions {
  /** How far a midpoint may wander, as a share of the span it sits on. */
  readonly roughness?: number;
  /** How short a segment has to get before it is left alone, in drawing units. */
  readonly finest?: number;
  /** How many times a segment may be split. */
  readonly depth?: number;
}

/**
 * An outline with detail put back into it, down to the given size.
 *
 * Midpoint displacement: each segment is halved, and the new point is pushed
 * off the line by an amount the noise decides, then each half is halved again.
 * The displacement shrinks with the segment, which is what makes the result
 * look the same at every scale rather than lumpy at one.
 */
export function withDetail(
  outline: Outline,
  noise: Noise,
  finest: number,
  options: DetailOptions = {},
): Outline {
  const roughness = options.roughness ?? 0.16;
  const depth = options.depth ?? 4;
  // The curves are spent first. Below the depth they were drawn at they are
  // no longer describing anything — a bezier drawn for a continent says
  // nothing true about a headland — so they become points, and the points get
  // the roughness the drawing never had.
  const points = flatten(outline, finest * 2);
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    for (const point of roughen(
      points[i - 1]!,
      points[i]!,
      noise,
      finest,
      roughness,
      depth,
    )) {
      segments.push({ to: point });
    }
  }
  return { from: outline.from, segments };
}

/** The points of one run, split until each piece is smaller than `finest`. */
function roughen(
  from: Point,
  to: Point,
  noise: Noise,
  finest: number,
  roughness: number,
  depth: number,
): Point[] {
  const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (depth <= 0 || span <= finest) return [to];
  const midX = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;
  // Off the line, not along it: a coast wanders sideways.
  const alongX = (to[0] - from[0]) / span;
  const alongY = (to[1] - from[1]) / span;
  // Sampled at the scale of the piece being split, so each halving asks the
  // noise a different question and the coast is rough at every size rather
  // than at one. Sampled at the midpoint itself, so this stretch of coast
  // always bends the same way however the map is cut into tiles.
  const push = noise.at(midX / span, midY / span) * span * roughness;
  const mid: Point = [midX - alongY * push, midY + alongX * push];
  return [
    ...roughen(from, mid, noise, finest, roughness, depth - 1),
    ...roughen(mid, to, noise, finest, roughness, depth - 1),
  ];
}

/**
 * How fine the detail should go for a tile: about a pixel's worth.
 *
 * Below that nobody can see it and every point is wasted work, and above it
 * the coast visibly straightens.
 */
export function finestFor(
  box: { left: number; right: number },
  size: number,
): number {
  return ((box.right - box.left) / size) * 1.5;
}
