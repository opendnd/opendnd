import type { PoolClient } from 'pg';
import { NotFoundError, ValidationError } from './store';
import type { Visibility } from './worlds';

/**
 * A module: a world's content, published.
 *
 * The rows of its layer are the module. What is kept beside them is what a
 * catalogue needs to say: where it came from, what it holds, who may see it.
 */
export interface Module {
  readonly id: string;
  /** The content address: `sha256:` and the hex digest of the content. */
  readonly digest: string;
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly summary?: string;
  readonly visibility: Visibility;
  /** Records by model, counted at publication. */
  readonly contents: Record<string, number>;
  readonly total: number;
  /** The world it was published from, while that world exists. */
  readonly sourceWorld?: string;
  readonly publishedAt: string;
  /** Where it sits in a world's stack, when listed for a world. */
  readonly position?: number;
}

export interface PublishRequest {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly summary?: string;
  readonly visibility?: Visibility;
}

interface ModuleRow {
  id: string;
  digest: string;
  name: string;
  version: string;
  license: string | null;
  summary: string | null;
  visibility: Visibility;
  contents: Record<string, number>;
  source_world: string | null;
  created_at: Date;
  position?: number;
}

const COLUMNS = `m.id, m.digest, m.name, m.version, m.license, m.summary,
  m.visibility, m.contents, m.source_world, m.created_at`;

/** Public modules, and those published from a world the user belongs to. */
const VISIBLE_TO = `(m.visibility = 'public'
  or m.source_world in (select world_id from world_member where user_id = $1))`;

/**
 * Snapshot a world's own content as a module.
 *
 * Every live record in the world's own layer, except the world's own record,
 * is copied into a new layer of kind `module`, stamped with the module's
 * digest. The digest is taken over the content alone, with the fields that
 * say where a record is rather than what it is left out, so an unchanged
 * world publishes to the module that already exists.
 *
 * Row-level security lets a transaction read the layers of the world it is
 * set to and write only that world's own layer, so the copy is staged from
 * the world and written under the module in two steps, and the transaction
 * is left set to the world it began in.
 */
export async function publishModule(
  client: PoolClient,
  world: string,
  userId: string,
  request: PublishRequest,
): Promise<{ module: Module; existing: boolean }> {
  await enter(client, world);
  const { rows } = await client.query<{
    digest: string | null;
    contents: Record<string, number>;
  }>(
    `with own as (
       select model, id, body - 'world' - 'module' - 'recorded' as content
       from resource
       where layer_id = $1 and deleted_at is null and model <> 'world'
     )
     select 'sha256:' || encode(sha256(convert_to(
              string_agg(model || ' ' || id::text || ' ' || content::text,
                         E'\n' order by model, id),
              'utf8')), 'hex') as digest,
            coalesce((select jsonb_object_agg(model, n)
                      from (select model, count(*)::int as n from own group by model) c),
                     '{}'::jsonb) as contents
     from own`,
    [world],
  );
  const summary = rows[0];
  if (!summary?.digest) {
    throw new ValidationError('this world has nothing to publish yet', [
      { path: ['world'], message: 'no content' },
    ]);
  }

  const found = await client.query<ModuleRow>(
    `select ${COLUMNS} from module m where m.digest = $1`,
    [summary.digest],
  );
  if (found.rows[0]) return { module: toModule(found.rows[0]), existing: true };

  const id = crypto.randomUUID();
  const now = new Date();
  const row: ModuleRow = {
    id,
    digest: summary.digest,
    name: request.name,
    version: request.version,
    license: request.license ?? null,
    summary: request.summary ?? null,
    visibility: request.visibility ?? 'private',
    contents: summary.contents,
    source_world: world,
    created_at: now,
  };
  await client.query('insert into layer (id, kind) values ($1, $2)', [
    id,
    'module',
  ]);
  await client.query(
    `insert into module (id, digest, name, version, license, summary,
                         visibility, contents, source_world, published_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      row.digest,
      row.name,
      row.version,
      row.license,
      row.summary,
      row.visibility,
      row.contents,
      world,
      userId,
      now,
    ],
  );

  // Staged while the transaction reads as the world; a temporary table is
  // not governed by the policies, so it carries the rows across.
  await client.query(
    `create temp table publishing on commit drop as
       select model, id,
              jsonb_set(body - 'world', '{recorded,revision}', '1'::jsonb)
                || jsonb_build_object('module', $2::text) as body
       from resource
       where layer_id = $1 and deleted_at is null and model <> 'world'`,
    [world, row.digest],
  );
  await enter(client, id);
  await client.query(
    `insert into resource (layer_id, model, id, body, recorded_at)
     select $1, model, id, body, $2 from publishing`,
    [id, now],
  );
  await client.query(
    `insert into resource_version (layer_id, model, id, revision, body, recorded_at)
     select $1, model, id, 1, body, $2 from publishing`,
    [id, now],
  );
  await enter(client, world);
  return { module: toModule(row), existing: false };
}

/** The modules a user may enable, newest first. */
export async function modulesVisibleTo(
  client: PoolClient,
  userId: string,
): Promise<Module[]> {
  const { rows } = await client.query<ModuleRow>(
    `select ${COLUMNS} from module m where ${VISIBLE_TO} order by m.created_at desc`,
    [userId],
  );
  return rows.map(toModule);
}

/** One module, if the user may see it. */
export async function moduleFor(
  client: PoolClient,
  moduleId: string,
  userId: string,
): Promise<Module | undefined> {
  const { rows } = await client.query<ModuleRow>(
    `select ${COLUMNS} from module m where m.id = $2 and ${VISIBLE_TO}`,
    [userId, moduleId],
  );
  return rows[0] ? toModule(rows[0]) : undefined;
}

/** The modules a world reads beneath its own content, nearest first. */
export async function modulesOf(
  client: PoolClient,
  world: string,
): Promise<Module[]> {
  const { rows } = await client.query<ModuleRow>(
    `select ${COLUMNS}, wl.position
     from world_layer wl
     join module m on m.id = wl.layer_id
     where wl.world_id = $1 and wl.position > 0
     order by wl.position`,
    [world],
  );
  return rows.map(toModule);
}

/**
 * Enable a module in a world: its layer goes after everything the world
 * already reads, so the world's own records and earlier modules win over it.
 * Enabling one already enabled changes nothing and says so.
 */
export async function enableModule(
  client: PoolClient,
  world: string,
  moduleId: string,
  userId: string,
): Promise<{ module: Module; enabled: boolean }> {
  const found = await moduleFor(client, moduleId, userId);
  if (!found) throw new NotFoundError('module', moduleId);
  const already = await client.query<{ position: number }>(
    'select position from world_layer where world_id = $1 and layer_id = $2',
    [world, moduleId],
  );
  if (already.rows[0]) {
    return {
      module: { ...found, position: already.rows[0].position },
      enabled: false,
    };
  }
  const { rows } = await client.query<{ next: number }>(
    `select coalesce(max(position), 0)::int + 1 as next
     from world_layer where world_id = $1`,
    [world],
  );
  const position = rows[0]!.next;
  await client.query(
    'insert into world_layer (world_id, layer_id, position) values ($1, $2, $3)',
    [world, moduleId, position],
  );
  return { module: { ...found, position }, enabled: true };
}

/** Take a module out of a world's stack. The world's own overrides stay. */
export async function disableModule(
  client: PoolClient,
  world: string,
  moduleId: string,
): Promise<void> {
  const { rowCount } = await client.query(
    `delete from world_layer
     where world_id = $1 and layer_id = $2 and position > 0`,
    [world, moduleId],
  );
  if ((rowCount ?? 0) === 0) throw new NotFoundError('module', moduleId);
}

/** Set the layer the transaction reads and writes as. */
async function enter(client: PoolClient, layer: string): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['app.world', layer]);
}

function toModule(row: ModuleRow): Module {
  const total = Object.values(row.contents).reduce((sum, n) => sum + n, 0);
  return {
    id: row.id,
    digest: row.digest,
    name: row.name,
    version: row.version,
    ...(row.license ? { license: row.license } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    visibility: row.visibility,
    contents: row.contents,
    total,
    ...(row.source_world ? { sourceWorld: row.source_world } : {}),
    publishedAt: row.created_at.toISOString(),
    ...(row.position !== undefined ? { position: row.position } : {}),
  };
}
