import type { PoolClient } from 'pg';
import type { Identity } from './identity';
import { ConflictError, Store } from './store';

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const VISIBILITIES = ['private', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface World {
  readonly id: string;
  readonly name: string;
  readonly visibility: Visibility;
  readonly role?: Role;
  /** Set when the world is archived: kept, but not listed or served. */
  readonly archivedAt?: string;
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
 * Email and name are refreshed when they have changed, and an invitation
 * waiting on the email becomes a membership.
 */
export async function ensureUser(
  client: PoolClient,
  identity: Identity,
): Promise<string> {
  const { rows } = await client.query<{
    id: string;
    email: string | null;
    name: string | null;
  }>('select id, email, name from app_user where subject = $1', [
    identity.subject,
  ]);
  let id: string;
  const existing = rows[0];
  if (existing) {
    id = existing.id;
    const email = identity.email ?? existing.email;
    const name = identity.name ?? existing.name;
    if (email !== existing.email || name !== existing.name) {
      await client.query(
        'update app_user set email = $2, name = $3 where id = $1',
        [id, email, name],
      );
    }
  } else {
    // Two first requests can race; the one that loses reads the winner's row.
    const inserted = await client.query<{ id: string }>(
      `insert into app_user (id, subject, email, name)
       values ($1, $2, $3, $4)
       on conflict (subject) do nothing
       returning id`,
      [
        crypto.randomUUID(),
        identity.subject,
        identity.email ?? null,
        identity.name ?? null,
      ],
    );
    id =
      inserted.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          'select id from app_user where subject = $1',
          [identity.subject],
        )
      ).rows[0]!.id;
  }
  if (identity.email) await acceptInvitations(client, id, identity.email);
  return id;
}

/** Turn every invitation addressed to an email into a membership. */
async function acceptInvitations(
  client: PoolClient,
  userId: string,
  email: string,
): Promise<void> {
  const { rows } = await client.query<{ world_id: string; role: Role }>(
    `delete from world_invitation where lower(email) = lower($1)
     returning world_id, role`,
    [email],
  );
  for (const invitation of rows) {
    await client.query(
      `insert into world_member (world_id, user_id, role) values ($1, $2, $3)
       on conflict (world_id, user_id) do update set role = excluded.role`,
      [invitation.world_id, userId, invitation.role],
    );
  }
}

/**
 * Create a world, its content layer and its first member.
 *
 * The world is also a resource in its own right: a `world` record in its own
 * layer, so the calendar, the coordinate system and the current in-world time
 * are ontology content like everything else rather than platform settings. It
 * is written through the store, so it has a history and an event like any
 * other record.
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

  await client.query('select set_config($1, $2, true)', ['app.world', id]);
  await new Store(client, id).put('world', id, {
    name: options.name,
    canonStatus: 'canon',
    owner: options.ownerSubject,
    ...(options.summary ? { summary: options.summary } : {}),
  });
  return { id, name: options.name, visibility, role: 'owner' };
}

/**
 * The worlds a user belongs to, with the role they hold in each. Archived
 * worlds are listed separately, and only to their owners, who are the ones
 * able to restore them.
 */
export async function worldsFor(
  client: PoolClient,
  userId: string,
  options: { readonly archived?: boolean } = {},
): Promise<World[]> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    visibility: Visibility;
    role: Role;
    archived_at: Date | null;
  }>(
    options.archived
      ? `select w.id, w.name, w.visibility, m.role, w.archived_at
         from world w
         join world_member m on m.world_id = w.id
         where m.user_id = $1 and w.archived_at is not null and m.role = 'owner'
         order by w.name`
      : `select w.id, w.name, w.visibility, m.role, w.archived_at
         from world w
         join world_member m on m.world_id = w.id
         where m.user_id = $1 and w.archived_at is null
         order by w.name`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility,
    role: r.role,
    ...(r.archived_at ? { archivedAt: r.archived_at.toISOString() } : {}),
  }));
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
 * ordered: an owner may do anything an editor may. An archived world is not
 * there, except to the caller asking to restore it.
 */
export async function accessTo(
  client: PoolClient,
  worldId: string,
  userId: string | undefined,
  options: { readonly includeArchived?: boolean } = {},
): Promise<Access | undefined> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    visibility: Visibility;
    role: Role | null;
    archived_at: Date | null;
  }>(
    `select w.id, w.name, w.visibility, m.role, w.archived_at
     from world w
     left join world_member m on m.world_id = w.id and m.user_id = $2
     where w.id = $1 and ($3::boolean or w.archived_at is null)`,
    [worldId, userId ?? null, options.includeArchived ?? false],
  );
  const row = rows[0];
  if (!row) return undefined;
  const role = row.role ?? undefined;
  const world: World = {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ...(role ? { role } : {}),
    ...(row.archived_at ? { archivedAt: row.archived_at.toISOString() } : {}),
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

/** Who has been invited to a world and has not yet signed in. */
export async function invitationsOf(
  client: PoolClient,
  worldId: string,
): Promise<{ email: string; role: Role; invitedAt: string }[]> {
  const { rows } = await client.query<{
    email: string;
    role: Role;
    created_at: Date;
  }>(
    `select email, role, created_at from world_invitation
     where world_id = $1 order by created_at`,
    [worldId],
  );
  return rows.map((r) => ({
    email: r.email,
    role: r.role,
    invitedAt: r.created_at.toISOString(),
  }));
}

/** The user known by an email address, if one has signed in. */
export async function findUserByEmail(
  client: PoolClient,
  email: string,
): Promise<string | undefined> {
  const { rows } = await client.query<{ id: string }>(
    'select id from app_user where lower(email) = lower($1) limit 1',
    [email],
  );
  return rows[0]?.id;
}

/** Invite someone by email. Repeating an invitation updates the role. */
export async function invite(
  client: PoolClient,
  worldId: string,
  email: string,
  role: Role,
  invitedBy: string,
): Promise<void> {
  await client.query(
    `insert into world_invitation (world_id, email, role, invited_by)
     values ($1, lower($2), $3, $4)
     on conflict (world_id, email) do update
       set role = excluded.role, invited_by = excluded.invited_by`,
    [worldId, email, role, invitedBy],
  );
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
  if (member.role === 'owner') await assertAnotherOwner(client, worldId);
  await client.query(
    'delete from world_member where world_id = $1 and user_id = $2',
    [worldId, member.id],
  );
  return true;
}

/**
 * Add or change someone's role in a world. Demoting the last owner is
 * refused for the same reason removing them is.
 */
export async function setMember(
  client: PoolClient,
  worldId: string,
  userId: string,
  role: Role,
): Promise<void> {
  if (role !== 'owner') {
    const { rows } = await client.query<{ role: Role }>(
      'select role from world_member where world_id = $1 and user_id = $2',
      [worldId, userId],
    );
    if (rows[0]?.role === 'owner') await assertAnotherOwner(client, worldId);
  }
  await client.query(
    `insert into world_member (world_id, user_id, role) values ($1, $2, $3)
     on conflict (world_id, user_id) do update set role = excluded.role`,
    [worldId, userId, role],
  );
}

async function assertAnotherOwner(
  client: PoolClient,
  worldId: string,
): Promise<void> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*) as n from world_member
     where world_id = $1 and role = 'owner'`,
    [worldId],
  );
  if (Number(rows[0]!.n) <= 1) {
    throw new ConflictError(
      'a world must keep at least one owner, or nobody can admit anyone to it',
    );
  }
}

/**
 * Archive a world.
 *
 * The content stays. A world someone spent a year on should not be one click
 * from gone, and the layer it lives in is what a module snapshot would be
 * published from later. An owner can list archived worlds and restore one.
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

/** Bring an archived world back. */
export async function restoreWorld(
  client: PoolClient,
  worldId: string,
): Promise<void> {
  await client.query(
    'update world set archived_at = null, updated_at = now() where id = $1',
    [worldId],
  );
}

/** What a world has spent on model calls. */
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
