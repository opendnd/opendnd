import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAssets } from '../src/assets';
import { handler } from '../src/lambda/terrain-tiles';
import { terrainKey } from '../src/tiles';

const WORLD = '00000000-0000-4000-8000-000000000001';
const terrain = new TextEncoder().encode(
  JSON.stringify({
    width: 1000,
    height: 1000,
    shapes: [
      {
        group: 'Somewhere',
        kind: 'land',
        d: 'M300 300L700 300L700 700L300 700Z',
      },
    ],
  }),
);

describe('the terrain tile worker', () => {
  let root: string | undefined;

  afterEach(async () => {
    delete process.env.OPENDND_ASSETS;
    delete process.env.TERRAIN_PREWARM_ZOOM;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('pre-renders the globe levels after S3 stores terrain.json', async () => {
    root = await mkdtemp(join(tmpdir(), 'opendnd-terrain-'));
    process.env.OPENDND_ASSETS = root;
    process.env.TERRAIN_PREWARM_ZOOM = '1';
    const assets = new FileAssets(root);
    await assets.put(terrainKey(WORLD), terrain, 'application/json');

    const answer = await handler({
      Records: [{ s3: { object: { key: `worlds/${WORLD}/terrain.json` } } }],
    });

    expect(answer).toEqual({ worlds: 1, tiles: 5 });
    const cached = await assets.list(`worlds/${WORLD}/terrain-tiles/`, 10);
    expect(cached).toHaveLength(5);
    expect(cached.every((file) => file.key.endsWith('.png'))).toBe(true);
  });

  it('ignores unrelated object notifications', async () => {
    root = await mkdtemp(join(tmpdir(), 'opendnd-terrain-'));
    process.env.OPENDND_ASSETS = root;
    expect(
      await handler({
        Records: [{ s3: { object: { key: `worlds/${WORLD}/portrait.png` } } }],
      }),
    ).toEqual({ worlds: 0, tiles: 0 });
  });
});
