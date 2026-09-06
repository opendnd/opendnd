import { type ModelId, modelInfo, models, vocabularies } from '@opendnd/types';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { type RequestIdVariables, requestId } from 'hono/request-id';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { inTransaction, inWorld } from './db';
import { assertFormat, exportWorld } from './export';
import {
  ANONYMOUS_TIERS,
  GENERATORS,
  NoGeneratorError,
  REFERENCE_FIELDS,
  contextFor,
  generate,
  resolveInputs,
} from './generate';
import {
  type Identity,
  type IdentityResolver,
  UnauthorizedError,
} from './identity';
import { openApiDocument } from './openapi';
import { simulate } from './simulate';
import {
  ConflictError,
  type ListOptions,
  NotFoundError,
  type Resource,
  StaleError,
  Store,
  ValidationError,
  type WriteOptions,
  isModel,
} from './store';
import {
  ROLES,
  VISIBILITIES,
  accessTo,
  archiveWorld,
  createWorld,
  ensureUser,
  findUserByEmail,
  invitationsOf,
  invite,
  membersOf,
  removeMember,
  restoreWorld,
  setMember,
  usageFor,
  worldsFor,
} from './worlds';

/** What the request context carries beyond Hono's own. */
type Env = { Variables: { identity?: Identity } & RequestIdVariables };

/** A handler given a store already scoped to a world. */
type InWorld = (
  store: Store,
  world: string,
  identity: Identity | undefined,
) => Promise<Response>;

/** The same, for a route that also names a model. */
type Scoped = (
  store: Store,
  model: ModelId,
  world: string,
  identity: Identity | undefined,
) => Promise<Response>;

export interface AppOptions {
  readonly pool: Pool;
  /** Absent means every request is anonymous, which fails closed. */
  readonly identity?: IdentityResolver;
  /**
   * Origins allowed to call from a browser. Defaults to any, which is right
   * for a public API whose authorization is the bearer token, not the origin.
   */
  readonly origins?: readonly string[];
}

/** Every model id, so the route table can be built from the ontology. */
export const MODEL_IDS = Object.keys(models) as ModelId[];

/** The caller is known and is not allowed to do this. */
export class Forbidden extends Error {
  readonly code = 'forbidden';
  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
  }
}

const UUID = z.uuid();
const CELL = z.string().regex(/^[0-9a-f]{1,16}$/i, 'not a cell token');

/** What a list accepts, checked at the edge so a bad value is a 400 and not a database error. */
const listQuery = z.object({
  at: z.coerce.number().int().optional(),
  asOf: z.iso.datetime({ offset: true }).optional(),
  canonStatus: z.string().min(1).optional(),
  perspective: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  generatedBy: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  cell: CELL.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sort: z.enum(['id', 'name', 'updatedAt']).optional(),
  ids: z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()))
    .pipe(z.array(UUID).min(1).max(500))
    .optional(),
});

const narrowQuery = z.object({
  models: z
    .string()
    .transform((value) => value.split(',').map((m) => m.trim()))
    .pipe(z.array(z.string().refine(isModel, 'not a model')))
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const worldBody = z.object({
  name: z.string().trim().min(1, 'a world needs a name'),
  summary: z.string().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
});

const memberBody = z
  .object({
    subject: z.string().min(1).optional(),
    email: z.email().optional(),
    role: z.enum(ROLES),
  })
  .refine(
    (body) => (body.subject === undefined) !== (body.email === undefined),
    {
      error: 'name the person by subject or by email, and not both',
    },
  );

/**
 * The API.
 *
 * There is one route set per ontology model and it is generated from the
 * model registry, so adding a model to the ontology adds its routes without
 * anything being written here. Stored content lives under a world, because a
 * world is the tenant; generation does not, because generating something
 * needs no world and no account.
 */
export function createApp(options: AppOptions) {
  const { pool } = options;
  const app = new Hono<Env>();

  app.use('*', requestId());
  app.use(
    '*',
    cors({
      origin: options.origins ? [...options.origins] : '*',
      allowHeaders: ['authorization', 'content-type', 'if-match'],
      exposeHeaders: ['etag', 'x-request-id'],
    }),
  );
  app.use('*', async (c, next) => {
    if (options.identity) {
      const identity = await options.identity.resolve(
        c.req.header('authorization'),
      );
      if (identity) c.set('identity', identity);
    }
    await next();
  });

  /*
   * Every failure is answered in one shape: what went wrong, a code a client
   * can branch on, and the request id to quote when asking about it. An
   * unexpected failure is logged with its cause and reported without one; a
   * client cannot act on a stack trace, and it should not see one.
   */
  app.onError((error, c) => {
    const id = c.get('requestId');
    const problem = (
      status: ContentfulStatusCode,
      code: string,
      message: string,
      extra: Record<string, unknown> = {},
    ) => c.json({ error: message, code, requestId: id, ...extra }, status);
    if (error instanceof ValidationError) {
      return problem(400, error.code, error.message, { issues: error.issues });
    }
    if (error instanceof NoGeneratorError) {
      return problem(400, 'no-generator', error.message);
    }
    if (error instanceof UnauthorizedError) {
      return problem(401, 'unauthorized', error.message);
    }
    if (error instanceof Forbidden) {
      return problem(403, error.code, error.message);
    }
    if (error instanceof NotFoundError) {
      return problem(404, error.code, error.message);
    }
    if (error instanceof ConflictError) {
      return problem(409, error.code, error.message);
    }
    if (error instanceof StaleError) {
      return problem(412, error.code, error.message);
    }
    console.error(
      JSON.stringify({
        requestId: id,
        method: c.req.method,
        path: c.req.path,
        status: 500,
        error: error instanceof Error ? error.message : String(error),
      }),
      error,
    );
    return problem(500, 'internal', 'the request could not be completed');
  });

  /** Alive, and able to reach the database. */
  app.get('/health', async (c) => {
    try {
      await withTimeout(pool.query('select 1'), 2000);
      return c.json({ ok: true, database: 'ok' });
    } catch {
      return c.json({ ok: false, database: 'unreachable' }, 503);
    }
  });

  /**
   * The API's own description, generated from the ontology's schemas, so it
   * cannot drift from what the routes accept.
   */
  app.get('/v1/openapi.json', (c) =>
    c.json(openApiDocument({ url: new URL(c.req.url).origin })),
  );

  /**
   * The code lists, with their display text, so a form can label a choice
   * without carrying its own copy of the ontology's labels.
   */
  app.get('/v1/vocabularies', (c) => c.json({ vocabularies }));

  /**
   * The models this deployment serves, which is the ontology it was built
   * from: each with its name and description as the manifest states them,
   * and, where something generates it, what that generator takes.
   */
  app.get('/v1/models', (c) =>
    c.json({
      models: MODEL_IDS.map((id) => ({
        ...modelInfo[id],
        ...(GENERATORS[id] ? { generate: GENERATORS[id] } : {}),
      })),
    }),
  );

  /**
   * Everything an application needs to start: who the caller is and which
   * worlds they may open, in one request rather than three.
   */
  app.get('/v1/me', async (c) => {
    const identity = requireIdentity(c);
    const worlds = await inTransaction(pool, async (client) =>
      worldsFor(client, await ensureUser(client, identity)),
    );
    return c.json({
      subject: identity.subject,
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.name ? { name: identity.name } : {}),
      ...(identity.groups ? { groups: identity.groups } : {}),
      worlds,
    });
  });

  // The user's own worlds. Not world-scoped, so guarded here rather than by
  // row-level security. `?archived=true` lists the ones put away, to their
  // owners, so they can be brought back.
  app.get('/v1/worlds', async (c) => {
    const identity = requireIdentity(c);
    const archived = c.req.query('archived') === 'true';
    const worlds = await inTransaction(pool, async (client) =>
      worldsFor(client, await ensureUser(client, identity), { archived }),
    );
    return c.json({ worlds });
  });

  app.post('/v1/worlds', async (c) => {
    const identity = requireIdentity(c);
    const body = parse(worldBody, await json(c), 'world');
    const world = await inTransaction(pool, async (client) =>
      createWorld(client, {
        name: body.name,
        ownerId: await ensureUser(client, identity),
        ownerSubject: identity.subject,
        ...(body.visibility ? { visibility: body.visibility } : {}),
        ...(body.summary ? { summary: body.summary } : {}),
      }),
    );
    return c.json(world, 201);
  });

  /** Who belongs, and who has been invited and not yet arrived. */
  app.get('/v1/worlds/:world/members', async (c) =>
    administering(c, pool, async (client, world) =>
      c.json({
        members: await membersOf(client, world),
        invitations: await invitationsOf(client, world),
      }),
    ),
  );

  /**
   * Admit someone, or change their role. By subject when the application
   * knows it; by email when it does not, which is the usual case, in which
   * case the invitation waits until that person signs in.
   */
  app.post('/v1/worlds/:world/members', async (c) => {
    const body = parse(memberBody, await json(c), 'member');
    return administering(c, pool, async (client, world, userId) => {
      if (body.subject !== undefined) {
        const { rows } = await client.query<{ id: string }>(
          'select id from app_user where subject = $1',
          [body.subject],
        );
        const member = rows[0];
        if (!member) throw new NotFoundError('user', body.subject);
        await setMember(client, world, member.id, body.role);
        return c.body(null, 204);
      }
      const email = body.email!;
      const known = await findUserByEmail(client, email);
      if (known !== undefined) {
        await setMember(client, world, known, body.role);
        return c.body(null, 204);
      }
      await invite(client, world, email, body.role, userId);
      return c.json({ invited: email.toLowerCase(), role: body.role }, 202);
    });
  });

  app.delete('/v1/worlds/:world/members/:subject', async (c) =>
    administering(c, pool, async (client, world) => {
      const subject = param(c, 'subject');
      const removed = await removeMember(client, world, subject);
      if (!removed) throw new NotFoundError('member', subject);
      return c.body(null, 204);
    }),
  );

  /** Archive a world. The content stays; it stops being listed. */
  app.delete('/v1/worlds/:world', async (c) =>
    administering(c, pool, async (client, world) => {
      await archiveWorld(client, world);
      return c.body(null, 204);
    }),
  );

  /** Bring an archived world back. */
  app.post('/v1/worlds/:world/$restore', async (c) =>
    administering(
      c,
      pool,
      async (client, world) => {
        await restoreWorld(client, world);
        return c.body(null, 204);
      },
      { includeArchived: true },
    ),
  );

  /** What has been spent on model calls in this world. Owners' business. */
  app.get('/v1/worlds/:world/usage', (c) =>
    administering(c, pool, async (client, world) =>
      c.json(await usageFor(client, world)),
    ),
  );

  /**
   * Generation without a world and without an account, which is the flow the
   * original API had and the one that lets somebody try the thing before they
   * decide to keep anything. What an anonymous caller may ask for is bounded,
   * because a whole kingdom is seconds of processor time on request.
   */
  app.post('/v1/:model/$generate', async (c) => {
    const model = modelParam(param(c, 'model'));
    const input = await json(c);
    if (model === 'place' && c.get('identity') === undefined) {
      const tier = String(input.tier ?? 'town');
      if (!ANONYMOUS_TIERS.includes(tier)) {
        throw new ValidationError(
          `a ${tier} is generated inside a world by a signed-in caller; without an account, ask for a settlement or a county`,
          [{ path: ['tier'], message: 'too large for an anonymous request' }],
        );
      }
    }
    const resources = generate(
      model,
      input,
      contextFor({
        world:
          typeof input.world === 'string' ? input.world : crypto.randomUUID(),
        ...(typeof input.seedPath === 'string'
          ? { seedPath: input.seedPath }
          : {}),
      }),
    );
    return c.json({ resources });
  });

  /**
   * Run the history simulation over a world, a house or a place.
   *
   * The run is synchronous, which is honest about what it is: centuries of a
   * realm take seconds of processor time. Left unsaved it returns what it
   * produced for the caller to look at; saved, it writes the lot in one
   * transaction and one event.
   */
  app.post('/v1/worlds/:world/:model/:id/$simulate', (c) =>
    write(c, async (store, model, world, identity) => {
      const result = await simulate(
        store,
        { model, id: uuidParam(c, 'id') },
        await json(c),
        (seedPath) =>
          contextFor({
            world,
            seedPath,
            ...(identity ? { requestedBy: identity.subject } : {}),
          }),
      );
      return c.json(result);
    }),
  );

  /**
   * Save many resources at once.
   *
   * Generating a realm produces upwards of a thousand resources, and asking
   * a client to post each one would make keeping what it just generated a
   * thousand requests. They are validated individually and written in one
   * transaction, so a batch either lands whole or not at all.
   */
  app.post('/v1/worlds/:world/$import', (c) =>
    withWorld(c, true, async (store, world) => {
      const body = await json(c);
      const entries = body.resources;
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new ValidationError(
          'send { resources: [{ model, resource }] } with at least one entry',
          [{ path: ['resources'], message: 'required' }],
        );
      }
      const resources = entries.map((entry, index) => {
        const record = entry as Record<string, unknown>;
        const model = record.model;
        if (typeof model !== 'string' || !isModel(model)) {
          throw new ValidationError(
            `entry ${index} names no model this ontology defines`,
            [{ path: ['resources', index, 'model'], message: 'unknown model' }],
          );
        }
        const resource = (record.resource ?? record) as Record<string, unknown>;
        return { model, body: resource };
      });
      const count = await store.import(resources, {
        summary: `imported ${resources.length} resources`,
      });
      return c.json({ imported: count, world }, 201);
    }),
  );

  /**
   * One search box across every model, because a person looking for Itumeist
   * does not know whether it is a place, a title or a house, and here it is
   * likely to be all three.
   */
  app.get('/v1/worlds/:world/$search', (c) =>
    withWorld(c, false, async (store) => {
      const query = parse(narrowQuery, c.req.query(), 'query');
      return c.json({
        results: await store.search(c.req.query('q') ?? '', {
          ...(query.models ? { models: query.models as ModelId[] } : {}),
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
        }),
      });
    }),
  );

  /** Everything in a world, as a bundle or as prose. */
  app.get('/v1/worlds/:world/$export/:format', (c) => {
    const format = assertFormat(param(c, 'format'));
    const { at } = parse(listQuery.pick({ at: true }), c.req.query(), 'query');
    return withWorld(c, false, async (store) => {
      const { contentType, body } = await exportWorld(store, format, at);
      return c.body(body, 200, { 'content-type': contentType });
    });
  });

  // One route set per model, under the world that owns the content.
  app.get('/v1/worlds/:world/:model', (c) =>
    read(c, async (store, model) =>
      c.json(await store.list(model, listOptions(c))),
    ),
  );

  app.get('/v1/worlds/:world/:model/:id', (c) =>
    read(c, async (store, model) => {
      const id = uuidParam(c, 'id');
      const resource = await store.get(model, id, listOptions(c));
      if (resource === undefined) throw new NotFoundError(model, id);
      return stored(c, resource, 200);
    }),
  );

  /**
   * Create. A body may name its own id, in which case that id must be free:
   * a second post of the same thing is a conflict, not a quiet replacement.
   */
  app.post('/v1/worlds/:world/:model', (c) =>
    write(c, async (store, model) => {
      const body = await json(c);
      if (typeof body.id === 'string') {
        return stored(c, await store.create(model, body.id, body), 201);
      }
      return stored(c, await store.put(model, crypto.randomUUID(), body), 201);
    }),
  );

  app.put('/v1/worlds/:world/:model/:id', (c) =>
    write(c, async (store, model) =>
      stored(
        c,
        await store.put(
          model,
          uuidParam(c, 'id'),
          await json(c),
          precondition(c),
        ),
        200,
      ),
    ),
  );

  app.patch('/v1/worlds/:world/:model/:id', (c) =>
    write(c, async (store, model) =>
      stored(
        c,
        await store.patch(
          model,
          uuidParam(c, 'id'),
          await json(c),
          precondition(c),
        ),
        200,
      ),
    ),
  );

  app.delete('/v1/worlds/:world/:model/:id', (c) =>
    write(c, async (store, model) => {
      await store.remove(model, uuidParam(c, 'id'));
      return c.body(null, 204);
    }),
  );

  /** Everything in this world that refers to a resource. */
  app.get('/v1/worlds/:world/:model/:id/references', (c) =>
    read(c, async (store) => {
      const query = parse(narrowQuery, c.req.query(), 'query');
      return c.json({
        references: await store.references(uuidParam(c, 'id'), {
          ...(query.models ? { models: query.models as ModelId[] } : {}),
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
        }),
      });
    }),
  );

  /** Every version of a resource, newest first. */
  app.get('/v1/worlds/:world/:model/:id/history', (c) =>
    read(c, async (store, model) =>
      c.json({ history: await store.history(model, uuidParam(c, 'id')) }),
    ),
  );

  /**
   * Generation inside a world, where the species and culture a generator
   * needs can be named by id instead of sent. Nothing is saved: the caller
   * decides what to keep and posts it back.
   */
  app.post('/v1/worlds/:world/:model/$generate', (c) =>
    read(c, async (store, model, world, identity) => {
      const input = await resolveInputs(
        await json(c),
        REFERENCE_FIELDS,
        (m, id) => store.get(m, id),
      );
      const resources = generate(
        model,
        input,
        contextFor({
          world,
          ...(typeof input.seedPath === 'string'
            ? { seedPath: input.seedPath }
            : {}),
          ...(identity ? { requestedBy: identity.subject } : {}),
        }),
      );
      return c.json({ resources });
    }),
  );

  return app;

  /** Run a handler with a store scoped to the world, for reading. */
  function read(c: Context<Env>, handler: Scoped): Promise<Response> {
    return scoped(c, false, handler);
  }

  /** Run a handler with a store scoped to the world, for writing. */
  function write(c: Context<Env>, handler: Scoped): Promise<Response> {
    return scoped(c, true, handler);
  }

  function scoped(
    c: Context<Env>,
    writing: boolean,
    handler: Scoped,
  ): Promise<Response> {
    const model = modelParam(param(c, 'model'));
    return withWorld(c, writing, (store, world, identity) =>
      handler(store, model, world, identity),
    );
  }

  /**
   * Run a handler inside the world named in the path, having checked the
   * caller may do what they are asking.
   *
   * The world is entered before the check, because the check reads tables the
   * policies govern; everything the handler then does is confined to that
   * world whether the handler says so or not.
   */
  async function withWorld(
    c: Context<Env>,
    writing: boolean,
    handler: InWorld,
  ): Promise<Response> {
    const world = uuidParam(c, 'world');
    const identity = c.get('identity');

    return inWorld(pool, world, async (client: PoolClient) => {
      const userId = identity ? await ensureUser(client, identity) : undefined;
      const access = await accessTo(client, world, userId);
      if (!access) throw new NotFoundError('world', world);
      if (writing && !access.canWrite) {
        throw identity
          ? new Forbidden('this world is not yours to change')
          : new UnauthorizedError('this request needs an account');
      }
      if (!writing && !access.canRead) {
        throw identity
          ? new Forbidden('this world is not yours to read')
          : new UnauthorizedError('this request needs an account');
      }
      return handler(new Store(client, world), world, identity);
    });
  }
}

function modelParam(value: string): ModelId {
  if (!isModel(value)) throw new NotFoundError('model', value);
  return value;
}

/** Run a handler as a world's owner, or refuse. */
async function administering(
  c: Context<Env>,
  pool: Pool,
  handler: (
    client: PoolClient,
    world: string,
    userId: string,
  ) => Promise<Response>,
  options: { readonly includeArchived?: boolean } = {},
): Promise<Response> {
  const identity = requireIdentity(c);
  const world = uuidParam(c, 'world');
  return inTransaction(pool, async (client) => {
    const userId = await ensureUser(client, identity);
    const access = await accessTo(client, world, userId, options);
    if (!access) throw new NotFoundError('world', world);
    if (!access.canAdminister) {
      throw new Forbidden('only an owner may do that to a world');
    }
    return handler(client, world, userId);
  });
}

/**
 * A path parameter of a route that has already matched. Hono cannot know the
 * path from a handler typed only by its environment, so the absence that
 * cannot happen is still refused rather than passed on as undefined.
 */
function param(c: Context<Env>, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) {
    throw new Error(`route matched without a ${name} parameter`);
  }
  return value;
}

/** A path parameter that has to be an id, refused before it reaches a query. */
function uuidParam(c: Context<Env>, name: string): string {
  const value = param(c, name);
  if (!UUID.safeParse(value).success) {
    throw new ValidationError(`${value} is not a ${name} id`, [
      { path: [name], message: 'not a uuid' },
    ]);
  }
  return value;
}

function requireIdentity(c: Context<Env>): Identity {
  const identity = c.get('identity');
  if (!identity) throw new UnauthorizedError('this request needs an account');
  return identity;
}

async function json(c: Context<Env>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('not an object');
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ValidationError('the request body must be a JSON object', []);
  }
}

/** Check a value against a schema, or answer 400 with what was wrong. */
function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      `the ${what} is not valid: ${result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      result.error.issues,
    );
  }
  return result.data;
}

/** Query parameters that shape a read, including the two time axes. */
function listOptions(c: Context<Env>): ListOptions {
  const query = parse(listQuery, c.req.query(), 'query');
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  ) as ListOptions;
}

/**
 * The revision a write expects to replace, from `If-Match`. A client that
 * sends back the ETag it was given cannot overwrite a change it has not seen.
 */
function precondition(c: Context<Env>): WriteOptions {
  const header = c.req.header('if-match');
  if (header === undefined) return {};
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!match) {
    throw new ValidationError('If-Match must carry a revision number', [
      { path: ['If-Match'], message: 'not a revision' },
    ]);
  }
  return { expectedRevision: Number(match[1]) };
}

/** A resource, with its revision as the ETag a later write can send back. */
function stored(
  c: Context<Env>,
  resource: Resource,
  status: 200 | 201,
): Response {
  const revision = (resource.recorded as { revision?: number } | undefined)
    ?.revision;
  return c.json(resource, status, {
    ...(revision !== undefined ? { etag: `"${revision}"` } : {}),
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
