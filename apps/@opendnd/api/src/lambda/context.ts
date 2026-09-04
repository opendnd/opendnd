import type { Pool } from 'pg';
import { createApp } from '../app';
import { createPool } from '../db';
import { resolverFromEnv } from '../identity';
import { databaseUrl } from '../secrets';

let pool: Promise<Pool> | undefined;

/**
 * The connection pool, built once per container.
 *
 * Lambda reuses a container across invocations, so the pool and the database
 * URL are resolved on the first request and held. Rebuilding them per
 * invocation would open a connection per request, which is the usual way to
 * exhaust a Postgres connection limit from a function.
 */
export function poolFor(): Promise<Pool> {
  pool ??= (async () => {
    const url = await databaseUrl();
    if (url === undefined) {
      throw new Error(
        'Neither DATABASE_URL nor DATABASE_SECRET_ARN is set, so there is no database to serve.',
      );
    }
    return createPool(url);
  })();
  return pool;
}

let app: Promise<ReturnType<typeof createApp>> | undefined;

export function appFor(): Promise<ReturnType<typeof createApp>> {
  app ??= (async () => {
    const identity = resolverFromEnv();
    return createApp({
      pool: await poolFor(),
      ...(identity ? { identity } : {}),
    });
  })();
  return app;
}
