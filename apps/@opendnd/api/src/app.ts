import { type ModelId, models, vocabularies } from '@opendnd/types';
import { type Context, Hono } from 'hono';
import type { Pool, PoolClient } from 'pg';
import { inTransaction, inWorld } from './db';
import { assertFormat, exportWorld } from './export';
import {
  NoGeneratorError,
  REFERENCE_FIELDS,
  canGenerate,
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
  NotFoundError,
  Store,
  ValidationError,
  isModel,
  type ListOptions,
} from './store';
import {
  accessTo,
  archiveWorld,
  createWorld,
  ensureUser,
  membersOf,
  removeMember,
  setMember,
  usageFor,
  worldsFor,
} from './worlds';

/** What the request context carries beyond Hono's own. */
type Env = { Variables: { identity?: Identity } };

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
}

/** Every model id, so the route table can be built from the ontology. */
export const MODEL_IDS = Object.keys(models) as ModelId[];

class Forbidden extends Error {}

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

  app.use('*', async (c, next) => {
    if (options.identity) {
      const identity = await options.identity.resolve(
        c.req.header('authorization'),
      );
      if (identity) c.set('identity', identity);
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: error.issues }, 400);
    }
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ConflictError) {
      return c.json({ error: error.message }, 409);
    }
    if (error instanceof UnauthorizedError) {
      return c.json({ error: error.message }, 401);
    }
    if (error instanceof NoGeneratorError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof Forbidden) {
      return c.json({ error: error.message }, 403);
    }
    // An unexpected failure is logged with its cause and reported without
    // one: a client cannot act on a stack trace, and it should not see one.
    console.error('unhandled', error);
    return c.json({ error: 'the request could not be completed' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  /**
   * The API's own description, generated from the ontology's schemas, so it
   * cannot drift from what the routes accept.
   */
  app.get('/v1/openapi.json', (c) =>
    c.json(
      openApiDocument({
        url: new URL(c.req.url).origin,
      }),
    ),
  );

  /** The models this deployment serves, which is the ontology it was built from. */
  /**
   * The code lists, with their display text, so a form can label a choice
   * without carrying its own copy of the ontology's labels.
   */
  app.get('/v1/vocabularies', (c) => c.json({ vocabularies }));

  app.get('/v1/models', (c) =>
    c.json({
      models: MODEL_IDS.map((id) => ({
        id,
        generate: canGenerate(id),
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
  // row-level security.
  app.get('/v1/worlds', async (c) => {
    const identity = requireIdentity(c);
    const worlds = await inTransaction(pool, async (client) =>
      worldsFor(client, await ensureUser(client, identity)),
    );
    return c.json({ worlds });
  });

  app.post('/v1/worlds', async (c) => {
    const identity = requireIdentity(c);
    const body = await json(c);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0) {
      throw new ValidationError('a world needs a name', [
        { path: ['name'], message: 'required' },
      ]);
    }
    const world = await inTransaction(pool, async (client) =>
      createWorld(client, {
        name,
        ownerId: await ensureUser(client, identity),
        ownerSubject: identity.subject,
        ...(typeof body.visibility === 'string'
          ? { visibility: body.visibility as never }
          : {}),
        ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
      }),
    );
    return c.json(world, 201);
  });

  app.get('/v1/worlds/:world/members', async (c) =>
    administering(c, pool, async (client, world) =>
      c.json({ members: await membersOf(client, world) }),
    ),
  );

  app.delete('/v1/worlds/:world/members/:subject', async (c) =>
    administering(c, pool, async (client, world) => {
      const removed = await removeMember(client, world, param(c, 'subject'));
      if (!removed) throw new NotFoundError('member', param(c, 'subject'));
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

  app.post('/v1/worlds/:world/members', async (c) => {
    const identity = requireIdentity(c);
    const body = await json(c);
    const world = param(c, 'world');
    await inTransaction(pool, async (client) => {
      const userId = await ensureUser(client, identity);
      const access = await accessTo(client, world, userId);
      if (!access) throw new NotFoundError('world', world);
      if (!access.canAdminister) {
        throw new Forbidden('only an owner may change who belongs to a world');
      }
      const { rows } = await client.query<{ id: string }>(
        'select id from app_user where subject = $1',
        [body.subject],
      );
      const member = rows[0];
      if (!member) throw new NotFoundError('user', String(body.subject));
      await setMember(client, world, member.id, body.role as never);
    });
    return c.body(null, 204);
  });

  /**
   * Generation without a world and without an account, which is the flow the
   * original API had and the one that lets somebody try the thing before they
   * decide to keep anything.
   */
  app.post('/v1/:model/$generate', async (c) => {
    const model = modelParam(param(c, 'model'));
    const input = await json(c);
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
        { model, id: param(c, 'id') },
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

  /** What has been spent on model calls in this world. */
  app.get('/v1/worlds/:world/usage', (c) =>
    withWorld(c, false, async (_store, world) =>
      inTransaction(pool, async (client) =>
        c.json(await usageFor(client, world)),
      ),
    ),
  );

  /**
   * One search box across every model, because a person looking for Itumeist
   * does not know whether it is a place, a title or a house, and here it is
   * likely to be all three.
   */
  app.get('/v1/worlds/:world/$search', (c) =>
    withWorld(c, false, async (store) =>
      c.json({
        results: await store.search(c.req.query('q') ?? '', {
          ...modelsQuery(c.req.query('models')),
          ...limitQuery(c.req.query('limit')),
        }),
      }),
    ),
  );

  /** Everything in a world, as a bundle or as prose. */
  app.get('/v1/worlds/:world/$export/:format', async (c) => {
    const world = param(c, 'world');
    const format = assertFormat(param(c, 'format'));
    const at = Number(c.req.query('at'));
    const identity = c.get('identity');
    return inWorld(pool, world, async (client: PoolClient) => {
      const userId = identity ? await ensureUser(client, identity) : undefined;
      const access = await accessTo(client, world, userId);
      if (!access) throw new NotFoundError('world', world);
      if (!access.canRead) {
        throw identity
          ? new Forbidden('this world is not yours to read')
          : new UnauthorizedError('this request needs an account');
      }
      const { contentType, body } = await exportWorld(
        new Store(client, world),
        format,
        Number.isFinite(at) ? at : undefined,
      );
      return c.body(body, 200, { 'content-type': contentType });
    });
  });

  // One route set per model, under the world that owns the content.
  app.get('/v1/worlds/:world/:model', (c) =>
    read(c, async (store, model) =>
      c.json(await store.list(model, listOptions(c.req.query()))),
    ),
  );

  app.get('/v1/worlds/:world/:model/:id', (c) =>
    read(c, async (store, model) => {
      const id = param(c, 'id');
      const resource = await store.get(model, id, listOptions(c.req.query()));
      if (resource === undefined) throw new NotFoundError(model, id);
      return c.json(resource);
    }),
  );

  app.post('/v1/worlds/:world/:model', (c) =>
    write(c, async (store, model) => {
      const body = await json(c);
      const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
      return c.json(await store.put(model, id, body), 201);
    }),
  );

  app.put('/v1/worlds/:world/:model/:id', (c) =>
    write(c, async (store, model) =>
      c.json(await store.put(model, param(c, 'id'), await json(c))),
    ),
  );

  app.patch('/v1/worlds/:world/:model/:id', (c) =>
    write(c, async (store, model) =>
      c.json(await store.patch(model, param(c, 'id'), await json(c))),
    ),
  );

  app.delete('/v1/worlds/:world/:model/:id', (c) =>
    write(c, async (store, model) => {
      await store.remove(model, param(c, 'id'));
      return c.body(null, 204);
    }),
  );

  /**
   * Generation inside a world, where the species and culture a generator
   * needs can be named by id instead of sent. Nothing is saved: the caller
   * decides what to keep and posts it back.
   */
  /** Everything in this world that refers to a resource. */
  app.get('/v1/worlds/:world/:model/:id/references', (c) =>
    read(c, async (store) =>
      c.json({
        references: await store.references(param(c, 'id'), {
          ...modelsQuery(c.req.query('models')),
          ...limitQuery(c.req.query('limit')),
        }),
      }),
    ),
  );

  /** Every version of a resource, newest first. */
  app.get('/v1/worlds/:world/:model/:id/history', (c) =>
    read(c, async (store, model) =>
      c.json({ history: await store.history(model, param(c, 'id')) }),
    ),
  );

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
    const world = param(c, 'world');
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

/**
 * A path parameter of a route that has already matched. Hono cannot know the
 * path from a handler typed only by its environment, so the absence that
 * cannot happen is still refused rather than passed on as undefined.
 */
/** Run a handler as a world's owner, or refuse. */
async function administering(
  c: Context<Env>,
  pool: Pool,
  handler: (client: PoolClient, world: string) => Promise<Response>,
): Promise<Response> {
  const identity = requireIdentity(c);
  const world = param(c, 'world');
  return inTransaction(pool, async (client) => {
    const userId = await ensureUser(client, identity);
    const access = await accessTo(client, world, userId);
    if (!access) throw new NotFoundError('world', world);
    if (!access.canAdminister) {
      throw new Forbidden('only an owner may do that to a world');
    }
    return handler(client, world);
  });
}

function modelsQuery(value: string | undefined): { models?: ModelId[] } {
  if (!value) return {};
  const named = value
    .split(',')
    .map((m) => m.trim())
    .filter((m) => isModel(m));
  return named.length > 0 ? { models: named as ModelId[] } : {};
}

function limitQuery(value: string | undefined): { limit?: number } {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? { limit } : {};
}

function param(c: Context<Env>, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) {
    throw new Error(`route matched without a ${name} parameter`);
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

/** Query parameters that shape a read, including the two time axes. */
function listOptions(query: Record<string, string | undefined>): ListOptions {
  const at = query.at === undefined ? undefined : Number(query.at);
  return {
    ...(at !== undefined && Number.isFinite(at) ? { at } : {}),
    ...(query.asOf ? { asOf: query.asOf } : {}),
    ...(query.canonStatus ? { canonStatus: query.canonStatus } : {}),
    ...(query.perspective ? { perspective: query.perspective } : {}),
    ...(query.module ? { module: query.module } : {}),
    ...(query.generatedBy ? { generatedBy: query.generatedBy } : {}),
    ...(query.name ? { name: query.name } : {}),
    ...(query.cell ? { cell: query.cell } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.limit && Number.isFinite(Number(query.limit))
      ? { limit: Number(query.limit) }
      : {}),
  };
}
