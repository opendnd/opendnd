import { assetsFromEnv } from '../assets';
import { prewarmTerrain } from '../tiles';

interface TerrainEvent {
  /** A deliberate invocation may name one world directly. */
  readonly world?: string;
  /** S3 invokes the worker when a world's terrain.json is replaced. */
  readonly Records?: readonly {
    readonly s3?: { readonly object?: { readonly key?: string } };
  }[];
  /** S3 also publishes object creation onto EventBridge in a deployment. */
  readonly detail?: { readonly object?: { readonly key?: string } };
}

const TERRAIN_KEY = /^worlds\/([^/]+)\/terrain\.json$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Render the small, frequently visible part of a terrain tile pyramid.
 *
 * Deeper tiles are still generated and cached by the API when first viewed.
 * An S3 notification is the production trigger; accepting a direct world id
 * gives imports and local tooling the same operation to invoke deliberately.
 */
export const handler = async (
  event: TerrainEvent,
): Promise<{ worlds: number; tiles: number }> => {
  const worlds = new Set<string>();
  if (event.world && UUID.test(event.world)) worlds.add(event.world);
  const encodedKeys = [
    event.detail?.object?.key,
    ...(event.Records ?? []).map((record) => record.s3?.object?.key),
  ];
  for (const encoded of encodedKeys) {
    if (!encoded) continue;
    const key = decodeURIComponent(encoded.replace(/\+/g, ' '));
    const found = TERRAIN_KEY.exec(key);
    if (found?.[1] && UUID.test(found[1])) worlds.add(found[1]);
  }

  const assets = assetsFromEnv();
  const through = Number(process.env.TERRAIN_PREWARM_ZOOM ?? 4);
  let tiles = 0;
  for (const world of worlds) {
    tiles += await prewarmTerrain(assets, world, through);
  }
  if (tiles > 0) {
    console.log(`rendered ${tiles} terrain tiles for ${worlds.size} worlds`);
  }
  return { worlds: worlds.size, tiles };
};
