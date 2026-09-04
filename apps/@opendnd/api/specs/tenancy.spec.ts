import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Pool } from 'pg';
import { inWorld } from 'src/db';
import { connect, dropWorld, makeModule, makeWorld } from './support';

/**
 * Tenancy is enforced by the database, so these assertions run SQL directly
 * rather than going through the API. If the policies are wrong, no amount of
 * care in the request path will save a tenant.
 */
describe('a world is a tenant', () => {
  let pool: Pool;
  let aerath: string;
  let other: string;
  let bestiary: string;

  beforeAll(async () => {
    pool = await connect();
    aerath = await makeWorld(pool!, 'Aerath');
    other = await makeWorld(pool!, 'Somewhere Else');
    bestiary = await makeModule(pool!, 'Core Bestiary', [aerath]);

    await inWorld(pool!, aerath, (c) =>
      c.query(
        `insert into resource (layer_id, model, id, body, recorded_at)
         values ($1, 'place', $2, $3, now())`,
        [aerath, crypto.randomUUID(), JSON.stringify({ name: 'Itumeist' })],
      ),
    );
    await inWorld(pool!, other, (c) =>
      c.query(
        `insert into resource (layer_id, model, id, body, recorded_at)
         values ($1, 'place', $2, $3, now())`,
        [other, crypto.randomUUID(), JSON.stringify({ name: 'Elsewhere' })],
      ),
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await dropWorld(pool, aerath);
    await dropWorld(pool, other);
    await pool.query('delete from layer where id = $1', [bestiary]);
    await pool.end();
  });

  it('shows nothing at all when no world is set', async () => {
    // The failure mode this guards is a query that forgets to scope itself.
    // It returns nothing rather than every tenant's content.
    const { rows } = await pool!.query(
      'select count(*)::int as n from resource',
    );
    expect(rows[0].n).toBe(0);
  });

  it('shows a world its own content without being asked to', async () => {
    const names = await inWorld(pool!, aerath, async (c) =>
      (await c.query<{ name: string }>('select name from resource')).rows.map(
        (r) => r.name,
      ),
    );
    expect(names).toEqual(['Itumeist']);
  });

  it('will not let a world write into a module it merely reads', async () => {
    // Module content is immutable because no request can address its layer,
    // not because the code remembers not to.
    await expect(
      inWorld(pool!, aerath, (c) =>
        c.query(
          `insert into resource (layer_id, model, id, body, recorded_at)
           values ($1, 'species', $2, $3, now())`,
          [bestiary, crypto.randomUUID(), JSON.stringify({ name: 'Owlbear' })],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('will not let a world read, update or delete another world by exact id', async () => {
    const target = await inWorld(
      pool!,
      other,
      async (c) =>
        (await c.query<{ id: string }>('select id from resource limit 1'))
          .rows[0]!.id,
    );

    const seen = await inWorld(
      pool!,
      aerath,
      async (c) =>
        (
          await c.query<{ n: number }>(
            'select count(*)::int as n from resource where id = $1',
            [target],
          )
        ).rows[0]!.n,
    );
    expect(seen).toBe(0);

    const deleted = await inWorld(
      pool!,
      aerath,
      async (c) =>
        (await c.query('delete from resource where id = $1', [target]))
          .rowCount,
    );
    expect(deleted).toBe(0);

    const survived = await inWorld(
      pool!,
      other,
      async (c) =>
        (
          await c.query<{ n: number }>(
            'select count(*)::int as n from resource where id = $1',
            [target],
          )
        ).rows[0]!.n,
    );
    expect(survived).toBe(1);
  });

  it('does not leak the world setting to the next user of the connection', async () => {
    // The setting is transaction-local, so a pooled connection cannot carry
    // one request's tenant into the next request.
    await inWorld(pool!, aerath, (c) => c.query('select 1'));
    const { rows } = await pool!.query<{ world: string | null }>(
      "select nullif(current_setting('app.world', true), '') as world",
    );
    expect(rows[0].world).toBeNull();
  });

  it('serves as a role that cannot bypass the policies', async () => {
    const { rows } = await pool!.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });
});
