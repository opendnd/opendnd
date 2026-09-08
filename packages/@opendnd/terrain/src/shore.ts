import { type Grid, columnOn } from './hydrology';

/**
 * How far everywhere is from the sea.
 *
 * The one thing a drawn map really tells you about height: the coast is the
 * zero line, and ground generally rises away from it. A distance transform
 * over the whole field gives every land cell its distance from salt water and
 * every sea cell its distance from land, which is the base everything else is
 * laid on: land rises inland, the shelf falls away offshore.
 *
 * Two passes of a chamfer, forwards then backwards, which is within a few
 * percent of true distance and costs one visit each way rather than a search.
 */
export function distanceFromShore(
  grid: Grid,
  land: Uint8Array,
): { inland: Float32Array; offshore: Float32Array } {
  return {
    inland: chamfer(grid, land, 1),
    offshore: chamfer(grid, land, 0),
  };
}

/** Distance from the nearest cell that is not `of`, in cell widths. */
export function chamfer(
  grid: Grid,
  mask: Uint8Array,
  of: number,
): Float32Array {
  const { width, height } = grid;
  const far = width + height;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = mask[i] === of ? far : 0;

  const near = (i: number, x: number, y: number, span: number): void => {
    const nx = columnOn(grid, x);
    if (nx < 0 || y < 0 || y >= height) return;
    const candidate = out[y * width + nx]! + span;
    if (candidate < out[i]!) out[i] = candidate;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (out[i] === 0) continue;
      near(i, x - 1, y, 1);
      near(i, x, y - 1, 1);
      near(i, x - 1, y - 1, Math.SQRT2);
      near(i, x + 1, y - 1, Math.SQRT2);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (out[i] === 0) continue;
      near(i, x + 1, y, 1);
      near(i, x, y + 1, 1);
      near(i, x + 1, y + 1, Math.SQRT2);
      near(i, x - 1, y + 1, Math.SQRT2);
    }
  }
  return out;
}
