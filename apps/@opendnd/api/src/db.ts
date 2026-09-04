import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';

/**
 * The role the API serves as. It deliberately owns nothing and is not a
 * superuser, because both of those bypass row-level security: a superuser
 * unconditionally, an owner unless the table forces it. Serving as this role
 * is what makes the tenancy policies real rather than decorative.
 */
export const APP_ROLE = 'opendnd_app';

export const DEFAULT_DATABASE_URL = `postgres://${APP_ROLE}:${APP_ROLE}@localhost:5432/opendnd`;

/** Migrations and role management need the owner, which the API never uses. */
export const DEFAULT_ADMIN_URL =
  'postgres://opendnd:opendnd@localhost:5432/opendnd';

/** A connection pool for serving requests. One per process. */
export function createPool(url = process.env.DATABASE_URL): Pool {
  return new Pool({ connectionString: url ?? DEFAULT_DATABASE_URL });
}

/** A connection pool for migrating and granting. */
export function createAdminPool(url = process.env.DATABASE_ADMIN_URL): Pool {
  return new Pool({ connectionString: url ?? DEFAULT_ADMIN_URL });
}

/**
 * Run work in a transaction with no world set. Use it for the tenancy tables
 * themselves — worlds, users, memberships — which are not world-scoped and are
 * guarded by the API's own authorization rather than by row-level security.
 */
export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run work in a transaction scoped to one world.
 *
 * The world is set as a transaction-local setting, which is what the row-level
 * security policies read. Everything inside sees only content the world can
 * see, whether or not the query says so, and the setting cannot leak to the
 * next borrower of the connection because it is discarded with the
 * transaction.
 */
export async function inWorld<T>(
  pool: Pool,
  world: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, async (client) => {
    await client.query('select set_config($1, $2, true)', ['app.world', world]);
    return work(client);
  });
}

/**
 * Apply every migration not yet applied, in filename order, each in its own
 * transaction. Migrations run as the connecting role, which locally is the
 * database owner; a deployment should migrate as the owner and serve as a role
 * without it.
 */
export async function migrate(
  pool: Pool,
  directory: string,
): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const applied = new Set(
    (
      await pool.query<{ name: string }>('select name from schema_migration')
    ).rows.map((r) => r.name),
  );
  const pending = readdirSync(directory)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));

  for (const name of pending) {
    const sql = readFileSync(join(directory, name), 'utf8');
    await inTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migration (name) values ($1)', [
        name,
      ]);
    });
  }
  return pending;
}

/**
 * Create the application role if it is absent and grant it what the API
 * needs: nothing on the schema itself, everything on the rows, and the same
 * for tables a later migration adds.
 *
 * Run after every migration, because a grant on "all tables" covers the
 * tables that exist when it runs and no others.
 */
export async function ensureAppRole(
  pool: Pool,
  password = process.env.DATABASE_APP_PASSWORD ?? APP_ROLE,
): Promise<void> {
  const { rows } = await pool.query<{ exists: boolean }>(
    'select exists (select 1 from pg_roles where rolname = $1) as exists',
    [APP_ROLE],
  );
  const verb = rows[0]?.exists ? 'alter' : 'create';
  // DDL cannot take bind parameters, so the statement is built by the server
  // with `format`, whose %I and %L quote an identifier and a literal
  // correctly, and then executed. The password never appears in a string
  // this code concatenates.
  const statement = await pool.query<{ ddl: string }>(
    `select format('${verb} role %I with login password %L', $1::text, $2::text) as ddl`,
    [APP_ROLE, password],
  );
  await pool.query(statement.rows[0]!.ddl);
  await pool.query(`grant usage on schema public to ${APP_ROLE}`);
  await pool.query(
    `grant select, insert, update, delete on all tables in schema public to ${APP_ROLE}`,
  );
  await pool.query(
    `grant usage, select on all sequences in schema public to ${APP_ROLE}`,
  );
  await pool.query(
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${APP_ROLE}`,
  );
  await pool.query(
    `alter default privileges in schema public grant usage, select on sequences to ${APP_ROLE}`,
  );
}
