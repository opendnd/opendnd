import type { PoolClient } from 'pg';
import type { Identity } from './identity';
import { ConflictError } from './store';

export type Role = 'owner' | 'editor' | 'viewer';
export type Visibility = 'private' | 'link' | 'public';

export interface World {
  readonly id: string;
  readonly name: string;
  readonly visibility: Visibility;
  readonly role?: Role;
}

/**
 * The tenancy tables are not world-scoped and so are not covered by row-level
 * security; the rules here are the only thing guarding them. Every function
 * takes the user whose access is in question and none of them infer it.
 */

/**
 * Find or create the user behind an identity.
 *
 * Cognito is the record of who someone is, so a user row appears the first
 * time a subject is seen rather than through a separate registration step.
 * Email and name are refreshed on the way past, since they can change in the
 * pool.
 */
export async function ensureUser(
  client: PoolClient,
  identity: Identity,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into app_user (id, subject, email, name)
     values ($1, $2, $3, $4)
     on conflict (subject) do update
       set email = coalesce(excluded.email, app_user.email),
           name = coalesce(excluded.name, app_user.name)
     returning id`,
    [
      crypto.randomUUID(),
      identity.subject,
      identity.email ?? null,
      identity.name ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * Create a world, its content layer and its first member.
 *
 * The world is also a resource in its own right: a `world` record in its own
 * layer, so the calendar, the coordinate system and the current in-world time
 * are ontology content like everything else rather than platform settings.
 */
export async function createWorld(
  client: PoolClient,
  options: {
    readonly name: string;
    readonly ownerId: string;
    readonly ownerSubject: string;
    readonly visibility?: Visibility;
    readonly summary?: string;
  },
): Promise<World> {
  const id = crypto.randomUUID();
  const visibility = options.visibility ?? 'private';
  await client.query('insert into layer (id, kind) values ($1, $2)', [
    id,
    'world',
  ]);
  await client.query(
    'insert into world (id, name, visibility) values ($1, $2, $3)',
    [id, options.name, visibility],
  );
  await client.query(
    'insert into world_layer (world_id, layer_id, position) values ($1, $1, 0)',
    [id],
  );
  await client.query(
    'insert into world_member (world_id, user_id, role) values ($1, $2, $3)',
    [id, options.ownerId, 'owner'],
  );

  const now = new Date().toISOString();
  await client.query('select set_config($1, $2, true)', ['app.world', id]);
  await client.query(
    `insert into resource (layer_id, model, id, body, recorded_at)
     values ($1, 'world', $1, $2, $3)`,
    [
      id,
      {
        id,
        world: id,
        name: options.name,
        canonStatus: 'canon',
        owner: options.ownerSubject,
        ...(options.summary ? { summary: options.summary } : {}),
        recorded: { createdAt: now, updatedAt: now, revision: 1 },
      },
      now,
    ],
  );
  return { id, name: options.name, visibility, role: 'owner' };
}

/** The worlds a user belongs to, with the role they hold in each. */
export async function worldsFor(
  client: PoolClient,
  userId: string,
): Promise<World[]> {
  const { rows } = await client.query<World>(
    `select w.id, w.name, w.visibility, m.role
     from world w
     join world_member m on m.world_id = w.id
     where m.user_id = $1 and w.archived_at is null
     order by w.name`,
    [userId],
  );
  return rows;
}

export interface Access {
  readonly world: World;
  readonly role?: Role;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly canAdminister: boolean;
}

/**
 * What a user may do in a world.
 *
 * A public world is readable by anyone, which is what lets an atlas or a
 * codex be shared. Writing always needs a membership, and the roles are
 * ordered: an owner may do anything an editor may.
 */
export async function accessTo(
  client: PoolClient,
  worldId: string,
  userId: string | undefined,
): Promise<Access | undefined> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    visibility: Visibility;
    role: Role | null;
  }>(
    `select w.id, w.name, w.visibility, m.role
     from world w
     left join world_member m on m.world_id = w.id and m.user_id = $2
     where w.id = $1 and w.archived_at is null`,
    [worldId, userId ?? null],
  );
  const row = rows[0];
  if (!row) return undefined;
  const role = row.role ?? undefined;
  const world: World = {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ...(role ? { role } : {}),
  };
  return {
    world,
    ...(role ? { role } : {}),
    canRead: row.visibility === 'public' || role !== undefined,
    canWrite: role === 'owner' || role === 'editor',
    canAdminister: role === 'owner',
  };
}

/** Who belongs to a world, and as what. */
export async function membersOf(
  client: PoolClient,
  worldId: string,
): Promise<{ subject: string; email?: string; name?: string; role: Role }[]> {
  const { rows } = await client.query<{
    subject: string;
    email: string | null;
    name: string | null;
    role: Role;
  }>(
    `select u.subject, u.email, u.name, m.role
     from world_member m
     join app_user u on u.id = m.user_id
     where m.world_id = $1
     order by m.role, u.email nulls last`,
    [worldId],
  );
  return rows.map((r) => ({
    subject: r.subject,
    ...(r.email ? { email: r.email } : {}),
    ...(r.name ? { name: r.name } : {}),
    role: r.role,
  }));
}

/**
 * Remove someone from a world.
 *
 * The last owner cannot be removed: a world with no owner is one nobody can
 * admit anyone to or delete, which is a world nobody can fix.
 */
export async function removeMember(
  client: PoolClient,
  worldId: string,
  subject: string,
): Promise<boolean> {
  const { rows } = await client.query<{ id: string; role: Role }>(
    `select u.id, m.role from world_member m
     join app_user u on u.id = m.user_id
     where m.world_id = $1 and u.subject = $2`,
    [worldId, subject],
  );
  const member = rows[0];
  if (!member) return false;
  if (member.role === 'owner') {
    const { rows: owners } = await client.query<{ n: string }>(
      `select count(*) as n from world_member
       where world_id = $1 and role = 'owner'`,
      [worldId],
    );
    if (Number(owners[0]!.n) <= 1) {
      throw new ConflictError(
        'a world must keep at least one owner, or nobody can admit anyone to it',
      );
    }
  }
  await client.query(
    'delete from world_member where world_id = $1 and user_id = $2',
    [worldId, member.id],
  );
  return true;
}

/**
 * Archive a world.
 *
 * The content stays. A world someone spent a year on should not be one click
 * from gone, and the layer it lives in is what a module snapshot would be
 * published from later.
 */
export async function archiveWorld(
  client: PoolClient,
  worldId: string,
): Promise<void> {
  await client.query(
    'update world set archived_at = now(), updated_at = now() where id = $1',
    [worldId],
  );
}

/** What a user has spent on model calls in a world. */
export async function usageFor(
  client: PoolClient,
  worldId: string,
): Promise<{
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  chargeMicros: number;
}> {
  const { rows } = await client.query<Record<string, string>>(
    `select count(*) as calls,
            coalesce(sum(input_tokens), 0) as input_tokens,
            coalesce(sum(output_tokens), 0) as output_tokens,
            coalesce(sum(cost_micros), 0) as cost_micros,
            coalesce(sum(charge_micros), 0) as charge_micros
     from model_usage where world_id = $1`,
    [worldId],
  );
  const row = rows[0]!;
  return {
    calls: Number(row.calls),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costMicros: Number(row.cost_micros),
    chargeMicros: Number(row.charge_micros),
  };
}

/** Add or change someone's role in a world. */
export async function setMember(
  client: PoolClient,
  worldId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await client.query(
    `insert into world_member (world_id, user_id, role) values ($1, $2, $3)
     on conflict (world_id, user_id) do update set role = excluded.role`,
    [worldId, userId, role],
  );
}
