import { describe, expect, it } from 'bun:test';
import type { AssetStore } from '../src/assets';
import { TILE_KEY } from '../src/assets';
import { forget, renderTile, terrainKey } from '../src/tiles';

/** A world of one square island, held in memory. */
const WORLD = '00000000-0000-4000-8000-000000000001';
const terrain = {
  width: 1000,
  height: 1000,
  seed: 'test',
  shapes: [
    {
      group: 'Somewhere',
      kind: 'land',
      d: 'M300 300L700 300L700 700L300 700Z',
    },
  ],
};

const body = new TextEncoder().encode(JSON.stringify(terrain));
const store: AssetStore = {
  get: async (key) =>
    key === terrainKey(WORLD)
      ? {
          key,
          body,
          contentType: 'application/json',
          size: body.byteLength,
        }
      : undefined,
  put: async () => undefined,
  list: async () => [],
  delete: async () => undefined,
};

describe('a tile of a drawn world', () => {
  it('draws the column east of the last one as the first one again', async () => {
    forget(WORLD);
    // At zoom one there are two columns. A world is round, so the column
    // after the last is the first, and the one before the first is the last:
    // a map wider than the world asks for those copies, and they have to be
    // the world rather than blank paper.
    const first = await renderTile(store, WORLD, 1, 0, 0);
    const second = await renderTile(store, WORLD, 1, 1, 0);
    expect(first).toBeDefined();
    expect(await renderTile(store, WORLD, 1, 2, 0)).toBe(first!);
    expect(await renderTile(store, WORLD, 1, -2, 0)).toBe(first!);
    expect(await renderTile(store, WORLD, 1, -1, 0)).toBe(second!);
  });

  it('has no row above the top of the world or below its bottom', async () => {
    forget(WORLD);
    expect(await renderTile(store, WORLD, 1, 0, 2)).toBeUndefined();
    expect(await renderTile(store, WORLD, 1, 0, -1)).toBeUndefined();
  });

  it('accepts a repeated column in an address, and no such row', () => {
    expect(TILE_KEY.test('2/-1/0.svg')).toBe(true);
    expect(TILE_KEY.test('2/5/0.svg')).toBe(true);
    expect(TILE_KEY.test('2/0/-1.svg')).toBe(false);
  });
});
