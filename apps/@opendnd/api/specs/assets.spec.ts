import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { createApp } from 'src/app';
import {
  FileAssets,
  assetId,
  assetsFromEnv,
  storedType,
  typeOfKey,
} from 'src/assets';
import { DevIdentityResolver } from 'src/identity';
import { connect } from './support';

const RUN = crypto.randomUUID().slice(0, 8);
const DREW = `drew-assets-${RUN}`;

/** A one-pixel picture, invented here rather than taken from anywhere. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

describe('what a world keeps as files', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let root: string;
  let world: string;

  const call = (
    method: string,
    path: string,
    init: { body?: string | Uint8Array; type?: string; as?: string } = {},
  ) =>
    app.request(`http://api${path}`, {
      method,
      headers: {
        ...(init.type ? { 'content-type': init.type } : {}),
        ...(init.as === undefined
          ? {}
          : { authorization: `Bearer ${init.as}` }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });

  beforeAll(async () => {
    pool = await connect();
    root = await mkdtemp(join(tmpdir(), 'opendnd-assets-'));
    app = createApp({
      pool,
      identity: new DevIdentityResolver(),
      assets: new FileAssets(root),
    });
    // Made through the API, which is what makes the caller its owner.
    const made = await call('POST', '/v1/worlds', {
      body: JSON.stringify({ name: `Assets ${RUN}` }),
      type: 'application/json',
      as: `dev:${DREW}`,
    });
    world = ((await made.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('delete from layer where id = $1', [world]);
    await pool.query('delete from app_user where subject = $1', [DREW]);
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });

  it('stores a picture under the digest of its content, once however often it is sent', async () => {
    const first = await call('POST', `/v1/worlds/${world}/assets`, {
      body: PNG,
      type: 'image/png',
      as: `dev:${DREW}`,
    });
    expect(first.status).toBe(201);
    const stored = (await first.json()) as {
      id: string;
      contentType: string;
      size: number;
      path: string;
    };
    expect(stored.id).toBe(assetId(PNG, 'image/png'));
    expect(stored.contentType).toBe('image/png');
    expect(stored.size).toBe(PNG.byteLength);
    expect(stored.path).toBe(`/v1/worlds/${world}/assets/${stored.id}`);

    // The same picture again is the same address, so nothing is duplicated.
    const again = await call('POST', `/v1/worlds/${world}/assets`, {
      body: PNG,
      type: 'image/png',
      as: `dev:${DREW}`,
    });
    expect(((await again.json()) as { id: string }).id).toBe(stored.id);

    const listed = await call('GET', `/v1/worlds/${world}/assets`, {
      as: `dev:${DREW}`,
    });
    const { assets } = (await listed.json()) as {
      assets: { id: string; size: number }[];
    };
    expect(assets).toHaveLength(1);
    expect(assets[0]!.id).toBe(stored.id);
  });

  it('hands a stored picture back to anyone with its address, cached forever', async () => {
    const made = await call('POST', `/v1/worlds/${world}/assets`, {
      body: PNG,
      type: 'image/png',
      as: `dev:${DREW}`,
    });
    const { id } = (await made.json()) as { id: string };

    // No authorization: a browser asking for an `img` sends none. The address
    // is the digest, which is what stands in for a password here.
    const read = await call('GET', `/v1/worlds/${world}/assets/${id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(read.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);

    // An address that is not a digest is not looked for at all.
    expect(
      (await call('GET', `/v1/worlds/${world}/assets/../../etc`)).status,
    ).toBe(404);
    const absent = 'f'.repeat(64);
    expect(
      (await call('GET', `/v1/worlds/${world}/assets/${absent}.png`)).status,
    ).toBe(404);
  });

  it('refuses a kind of file a world does not hold, and an empty one', async () => {
    const page = await call('POST', `/v1/worlds/${world}/assets`, {
      body: '<script>alert(1)</script>',
      type: 'text/html',
      as: `dev:${DREW}`,
    });
    expect(page.status).toBe(400);
    const empty = await call('POST', `/v1/worlds/${world}/assets`, {
      body: new Uint8Array(),
      type: 'image/png',
      as: `dev:${DREW}`,
    });
    expect(empty.status).toBe(400);
  });

  it('will not let a stranger put a file in a world', async () => {
    const anonymous = await call('POST', `/v1/worlds/${world}/assets`, {
      body: PNG,
      type: 'image/png',
    });
    expect(anonymous.status).toBe(401);
  });

  it('serves a map tile at the address web maps use, and nothing shaped otherwise', async () => {
    const store = new FileAssets(root);
    await store.put(`worlds/${world}/tiles/3/4/5.png`, PNG, 'image/png');

    const tile = await call('GET', `/v1/worlds/${world}/tiles/3/4/5.png`);
    expect(tile.status).toBe(200);
    expect(tile.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await tile.arrayBuffer())).toEqual(PNG);

    // A world with no tile there says so rather than drawing nothing quietly.
    expect(
      (await call('GET', `/v1/worlds/${world}/tiles/3/4/6.png`)).status,
    ).toBe(404);
    // Not a tile address.
    expect(
      (await call('GET', `/v1/worlds/${world}/tiles/3/4/5.html`)).status,
    ).toBe(404);
    // One world's tiles are not another's, because the world is in the key.
    const elsewhere = crypto.randomUUID();
    expect(
      (await call('GET', `/v1/worlds/${elsewhere}/tiles/3/4/5.png`)).status,
    ).toBe(404);
  });

  it("draws a tile from the world's own shapes, at any depth", async () => {
    // A world with one square island in the middle of it.
    const store = new FileAssets(root);
    await store.put(
      `worlds/${world}/terrain.json`,
      new TextEncoder().encode(
        JSON.stringify({
          width: 1000,
          height: 1000,
          seed: 'a test',
          drawnTo: 6,
          shapes: [
            {
              group: 'Somewhere',
              kind: 'land',
              d: 'M300 300L700 300L700 700L300 700Z',
            },
          ],
        }),
      ),
      'application/json',
    );

    const middle = await call('GET', `/v1/worlds/${world}/tiles/0/0/0.svg`);
    expect(middle.status).toBe(200);
    expect(middle.headers.get('content-type')).toBe('image/svg+xml');
    expect(middle.headers.get('cache-control')).toContain('immutable');
    const svg = await middle.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');

    // Deeper than anything was drawn at: still a tile, and still drawn.
    const deep = await call(
      'GET',
      `/v1/worlds/${world}/tiles/14/8192/8192.svg`,
    );
    expect(deep.status).toBe(200);

    // The same tile twice is the same picture, or a map would shimmer.
    const again = await call('GET', `/v1/worlds/${world}/tiles/0/0/0.svg`);
    expect(await again.text()).toBe(svg);

    // A world with no shapes has nothing to draw.
    const nowhere = crypto.randomUUID();
    expect(
      (await call('GET', `/v1/worlds/${nowhere}/tiles/0/0/0.svg`)).status,
    ).toBe(404);
  });

  it('knows which types it holds and what each key holds', () => {
    expect(storedType('image/png; charset=binary')).toBe('image/png');
    expect(storedType('text/html')).toBeUndefined();
    expect(storedType(undefined)).toBeUndefined();
    expect(typeOfKey('abc.svg')).toBe('image/svg+xml');
    expect(typeOfKey('abc.wat')).toBe('application/octet-stream');
  });

  it('keeps files in a folder when the deployment has given it no bucket', () => {
    expect(assetsFromEnv({ OPENDND_ASSETS: '/tmp/x' })).toBeInstanceOf(
      FileAssets,
    );
    expect(assetsFromEnv({ ASSETS_BUCKET: '' })).toBeInstanceOf(FileAssets);
  });
});
