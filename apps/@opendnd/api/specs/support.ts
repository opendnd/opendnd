import { join } from 'node:path';
import { Pool } from 'pg';
import {
  DEFAULT_ADMIN_URL,
  DEFAULT_DATABASE_URL,
  createAdminPool,
  createPool,
  ensureAppRole,
  migrate,
} from 'src/db';

/**
 * The database the tests own, which is not the one anybody develops against.
 *
 * A test makes worlds, fills them and drops them again. Doing that in the
 * development database leaves the wreckage behind: this repository quietly
 * accumulated 1,355 dead layers holding three hundred thousand orphaned
 * versions that way. A database of its own costs one `create database` and
 * makes the question moot.
 *
 * `DATABASE_URL` and `DATABASE_ADMIN_URL` still win where they are set, so a
 * pipeline points the tests wherever it likes.
 */
const TEST_DATABASE = process.env.TEST_DATABASE ?? 'opendnd_test';

/** The same server and credentials, a different database. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const adminUrl =
  process.env.DATABASE_ADMIN_URL ??
  withDatabase(DEFAULT_ADMIN_URL, TEST_DATABASE);
const appUrl =
  process.env.DATABASE_URL ?? withDatabase(DEFAULT_DATABASE_URL, TEST_DATABASE);

/**
 * Create the test database, if this is the first run against this server.
 *
 * `create database` cannot run inside a transaction and has no `if not
 * exists`, so it is asked for only when the catalogue says it is missing.
 */
async function ensureDatabase(): Promise<void> {
  if (process.env.DATABASE_ADMIN_URL !== undefined) return;
  const maintenance = new Pool({
    connectionString: withDatabase(DEFAULT_ADMIN_URL, 'postgres'),
  });
  try {
    const { rows } = await maintenance.query<{ exists: boolean }>(
      'select exists (select 1 from pg_database where datname = $1) as exists',
      [TEST_DATABASE],
    );
    if (!rows[0]?.exists) {
      await maintenance.query(`create database "${TEST_DATABASE}"`);
    }
  } finally {
    await maintenance.end();
  }
}

/**
 * Bring the database up to date and hand back a pool that serves as the
 * application role.
 *
 * A missing database is a failure, not a skip: the API is a database
 * application, and the test task starts the one the repository ships. The
 * message says what to run if that has not happened.
 */
export async function connect(): Promise<Pool> {
  await ensureDatabase();
  const admin = createAdminPool(adminUrl);
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
  const pool = createPool(appUrl);
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
