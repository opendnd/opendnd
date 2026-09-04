import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelRequest, ModelResponse } from './message';

/**
 * A record of replies, keyed by exactly what produced them. Two things need
 * it: a test or a batch job that must run the same way twice without paying
 * twice, and a world that is regenerated after an edit somewhere else in it.
 */
export interface CacheStore {
  get(key: string): Promise<ModelResponse | undefined>;
  set(key: string, response: ModelResponse): Promise<void>;
}

/**
 * The cache key, which is also the prompt hash recorded in provenance: a
 * hash over the model and every field of the request that can change the
 * reply. Anything left out of it would let one request be answered with
 * another request's reply.
 */
export function promptHash(modelId: string, request: ModelRequest): string {
  return createHash('sha256')
    .update(canonicalJson({ modelId, request }))
    .digest('hex');
}

/** JSON with object keys in sorted order, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`;
}

/** For one process: a test run, a request, a batch. */
export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, ModelResponse>();

  async get(key: string): Promise<ModelResponse | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, response: ModelResponse): Promise<void> {
    this.entries.set(key, response);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * One file per reply under a directory, which makes a cache committable. A
 * fixture directory turns an AI-authored slice of a world into a test that
 * runs offline.
 */
export class FileCache implements CacheStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  async get(key: string): Promise<ModelResponse | undefined> {
    try {
      return JSON.parse(
        readFileSync(this.pathFor(key), 'utf8'),
      ) as ModelResponse;
    } catch {
      return undefined;
    }
  }

  async set(key: string, response: ModelResponse): Promise<void> {
    writeFileSync(this.pathFor(key), `${JSON.stringify(response, null, 2)}\n`);
  }

  private pathFor(key: string): string {
    return join(this.directory, `${key}.json`);
  }
}
