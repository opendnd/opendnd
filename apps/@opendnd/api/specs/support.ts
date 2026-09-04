import { join } from 'node:path';
import type { Pool } from 'pg';
import { createAdminPool, createPool, ensureAppRole, migrate } from 'src/db';

/**
 * Bring the database up to date and hand back a pool that serves as the
 * application role.
 *
 * A missing database is a failure, not a skip: the API is a database
 * application, and the test task starts the one the repository ships. The
 * message says what to run if that has not happened.
 */
export async function connect(): Promise<Pool> {
  const admin = createAdminPool();
  try {
    await migrate(admin, join(__dirname, '..', 'migrations'));
    await ensureAppRole(admin);
  } catch (cause) {
    throw new Error(
      'Postgres is not reachable. Run `docker compose up --detach --wait postgres` ' +
        'from the repository root, or point DATABASE_ADMIN_URL at a database.',
      { cause },
    );
  } finally {
    await admin.end();
  }
  const pool = createPool();
  await pool.query('select 1');
  return pool;
}

/** A world and its own content layer, for one test. */
export async function makeWorld(pool: Pool, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query('insert into layer (id, kind) values ($1, $2)', [
    id,
    'world',
  ]);
  await pool.query('insert into world (id, name) values ($1, $2)', [id, name]);
  await pool.query(
    'insert into world_layer (world_id, layer_id, position) values ($1, $1, 0)',
    [id],
  );
  return id;
}

/** A module layer, and the worlds that enable it, at the given position. */
export async function makeModule(
  pool: Pool,
  name: string,
  enabledBy: readonly string[] = [],
): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query('insert into layer (id, kind) values ($1, $2)', [
    id,
    'module',
  ]);
  await pool.query(
    'insert into module (id, digest, name, version) values ($1, $2, $3, $4)',
    [id, `sha256:${id}`, name, '1.0.0'],
  );
  for (const world of enabledBy) {
    await pool.query(
      'insert into world_layer (world_id, layer_id, position) values ($1, $2, 1)',
      [world, id],
    );
  }
  return id;
}

/** Remove a world, its layer and everything in it. */
export async function dropWorld(pool: Pool, id: string): Promise<void> {
  await pool.query('delete from layer where id = $1', [id]);
}
