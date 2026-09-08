import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Where a world's pictures and map tiles are kept.
 *
 * Files, not records: a portrait is bytes, and a world map is tens of
 * thousands of small pictures that nobody wants a row for. The API is the
 * only way in, so a picture is reached at an address under the world that
 * holds it rather than wherever it happened to be uploaded from, and a
 * deployment moves from a folder to a bucket by changing one setting.
 */
export interface StoredAsset {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly body: Uint8Array;
}

export interface AssetSummary {
  readonly key: string;
  readonly size: number;
}

export interface AssetStore {
  get(key: string): Promise<StoredAsset | undefined>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  list(prefix: string, limit: number): Promise<AssetSummary[]>;
  delete(key: string): Promise<void>;
}

/**
 * The kinds of file a world may hold, and the extension each is stored under.
 *
 * A short list rather than anything a caller names, because the store hands
 * these back to a browser with the type it was told: a world that could store
 * `text/html` under its own address could serve a page as the deployment.
 */
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'font/woff2': 'woff2',
};

const BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(TYPES).map(([type, extension]) => [extension, type]),
);

/** The stored type of a file offered as `contentType`, or none when it may not be stored. */
export function storedType(
  contentType: string | undefined,
): string | undefined {
  const bare = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return TYPES[bare] === undefined ? undefined : bare;
}

/** The type a stored key holds, read from its extension. */
export function typeOfKey(key: string): string {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** What a file is stored as: the digest of its content, and its extension. */
export function assetId(body: Uint8Array, contentType: string): string {
  const digest = createHash('sha256').update(body).digest('hex');
  return `${digest}.${TYPES[contentType]!}`;
}

export const ASSET_ID = /^[0-9a-f]{64}\.[a-z0-9]{2,5}$/;
/** `{z}/{x}/{y}.{extension}`, the way web maps have addressed tiles since the first one. */
export const TILE_KEY = /^(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.(png|jpg|webp|svg)$/;

/** Everything a world keeps sits under this, so one world cannot read another's. */
export function worldPrefix(world: string): string {
  return `worlds/${world}/`;
}

/** A folder on disk, which is what a development machine has instead of a bucket. */
export class FileAssets implements AssetStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    // A key is built by this module from a digest or a checked tile address,
    // but the check is here as well: nothing may climb out of the folder.
    if (key.includes('..') || key.startsWith('/')) {
      throw new Error(`bad asset key: ${key}`);
    }
    return join(this.root, ...key.split('/'));
  }

  async get(key: string): Promise<StoredAsset | undefined> {
    try {
      const body = await readFile(this.path(key));
      return {
        key,
        contentType: typeOfKey(key),
        size: body.byteLength,
        body: new Uint8Array(body),
      };
    } catch {
      return undefined;
    }
  }

  /** The type is not kept: on disk the key's extension is what says it. */
  async put(
    key: string,
    body: Uint8Array,
    _contentType?: string,
  ): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async list(prefix: string, limit: number): Promise<AssetSummary[]> {
    const found: AssetSummary[] = [];
    const walk = async (relative: string): Promise<void> => {
      if (found.length >= limit) return;
      let entries;
      try {
        entries = await readdir(this.path(relative), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (found.length >= limit) return;
        const child = `${relative}${entry.name}`;
        if (entry.isDirectory()) {
          await walk(`${child}/`);
        } else {
          const info = await stat(this.path(child));
          found.push({ key: child, size: info.size });
        }
      }
    };
    await walk(prefix.endsWith('/') || prefix === '' ? prefix : `${prefix}/`);
    return found;
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  /** Where a key lands on disk, for a script that fills the folder directly. */
  pathOf(key: string): string {
    return this.path(key).split(sep).join(sep);
  }
}

/** The bucket a deployment has. */
export class S3Assets implements AssetStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client({});
  }

  async get(key: string): Promise<StoredAsset | undefined> {
    try {
      const answer = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await answer.Body!.transformToByteArray();
      return {
        key,
        contentType: answer.ContentType ?? typeOfKey(key),
        size: body.byteLength,
        body,
      };
    } catch {
      return undefined;
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async list(prefix: string, limit: number): Promise<AssetSummary[]> {
    const answer = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: limit,
      }),
    );
    return (answer.Contents ?? []).map((object) => ({
      key: object.Key!,
      size: object.Size ?? 0,
    }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/**
 * The store this process has: the deployment's bucket when it was given one,
 * and otherwise a folder, which is what makes a world's pictures work on a
 * machine with no cloud account behind it.
 */
export function assetsFromEnv(
  env: Record<string, string | undefined> = process.env,
): AssetStore {
  const bucket = env.ASSETS_BUCKET;
  if (bucket !== undefined && bucket !== '') return new S3Assets(bucket);
  return new FileAssets(env.OPENDND_ASSETS ?? join(process.cwd(), '.assets'));
}
