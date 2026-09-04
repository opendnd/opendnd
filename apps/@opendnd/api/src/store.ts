import { type ModelId, models } from '@opendnd/types';
import type { PoolClient } from 'pg';

/** A stored resource, as the API hands it out. */
export type Resource = Record<string, unknown> & {
  id: string;
  world: string;
};

export interface ReadOptions {
  /** In-world time. Returns the state that held then. */
  readonly at?: number;
  /** Transaction time, ISO 8601. Returns the record as it was authored then. */
  readonly asOf?: string;
}

export interface ListOptions extends ReadOptions {
  readonly canonStatus?: string;
  readonly perspective?: string;
  readonly module?: string;
  readonly generatedBy?: string;
  /** Case-insensitive prefix match on the name. */
  readonly name?: string;
  /**
   * Quadtree cell token. Returns everything at or inside it, at any depth,
   * which is how a map asks for what is in view.
   */
  readonly cell?: string;
  readonly limit?: number;
  /** Id to continue after, from a previous page's `next`. */
  readonly cursor?: string;
}

export interface Page {
  readonly resources: Resource[];
  /** Cursor for the next page, absent when this is the last. */
  readonly next?: string;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The request is understood and refused because of the state it would leave. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(model: string, id: string) {
    super(`no ${model} ${id} in this world`);
    this.name = 'NotFoundError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Rows per statement on an import. Arrays keep the parameter count flat. */
const IMPORT_CHUNK = 1000;

/**
 * Content storage for one world.
 *
 * Every method takes a client already inside a world-scoped transaction, so
 * the queries here do not carry the world themselves: the database restricts
 * them to the layers the world reads. What the queries do carry is the
 * layering, because a read has to resolve the same resource appearing in
 * several layers down to the nearest one.
 */
export class Store {
  constructor(
    private readonly client: PoolClient,
    private readonly world: string,
  ) {}

  /** One resource, or undefined when this world has no such thing. */
  async get(
    model: ModelId,
    id: string,
    options: ReadOptions = {},
  ): Promise<Resource | undefined> {
    const page = await this.list(model, { ...options, cursor: undefined }, id);
    return page.resources[0];
  }

  /**
   * A page of resources of one model.
   *
   * Resolution comes first and filtering second: a world that overrides a
   * module's record decides that record's canon status and name, so a filter
   * applied before resolution would match on content the world has replaced.
   */
  async list(
    model: ModelId,
    options: ListOptions = {},
    onlyId?: string,
  ): Promise<Page> {
    assertModel(model);
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const params: unknown[] = [this.world, model];
    const resolved =
      options.asOf === undefined
        ? `select distinct on (r.model, r.id)
             r.id, r.body, r.deleted_at, r.canon_status, r.perspective,
             r.module_digest, r.generated_by, r.name, r.valid_from, r.valid_to,
             r.cell_id
           from resource r
           join world_layer wl on wl.layer_id = r.layer_id
           where wl.world_id = $1 and r.model = $2
           order by r.model, r.id, wl.position`
        : `select distinct on (v.model, v.id)
             v.id, v.body,
             case when v.deleted then v.recorded_at end as deleted_at,
             v.body ->> 'canonStatus' as canon_status,
             v.body ->> 'perspective' as perspective,
             v.body ->> 'module' as module_digest,
             v.body -> 'provenance' ->> 'generatedBy' as generated_by,
             v.body ->> 'name' as name,
             (v.body -> 'validTime' -> 'begin' ->> 'year')::int as valid_from,
             (v.body -> 'validTime' -> 'end' ->> 'year')::int as valid_to,
             null::bigint as cell_id
           from resource_version v
           join world_layer wl on wl.layer_id = v.layer_id
           where wl.world_id = $1 and v.model = $2
             and v.recorded_at <= $${params.push(options.asOf)}
           order by v.model, v.id, wl.position, v.revision desc`;

    const where = ['deleted_at is null'];
    if (onlyId !== undefined) where.push(`id = $${params.push(onlyId)}`);
    if (options.cursor !== undefined) {
      where.push(`id > $${params.push(options.cursor)}`);
    }
    if (options.canonStatus !== undefined) {
      where.push(`canon_status = $${params.push(options.canonStatus)}`);
    }
    if (options.perspective !== undefined) {
      where.push(`perspective = $${params.push(options.perspective)}`);
    }
    if (options.module !== undefined) {
      where.push(`module_digest = $${params.push(options.module)}`);
    }
    if (options.generatedBy !== undefined) {
      where.push(`generated_by = $${params.push(options.generatedBy)}`);
    }
    if (options.name !== undefined) {
      where.push(`name ilike $${params.push(`${options.name}%`)}`);
    }
    if (options.cell !== undefined) {
      // A cell's descendants are a contiguous range of ids, so a bounding
      // cell is two comparisons rather than a walk down the tree.
      const { min, max } = cellRange(options.cell);
      where.push(
        `cell_id between $${params.push(min)} and $${params.push(max)}`,
      );
    }
    if (options.at !== undefined) {
      const at = params.push(options.at);
      // Valid time is in-world: a record with no interval holds always, and
      // one that has ended is not part of the state at that moment.
      where.push(`(valid_from is null or valid_from <= $${at})`);
      where.push(`(valid_to is null or valid_to > $${at})`);
    }

    const rows = await this.client.query<{ id: string; body: Resource }>(
      `select id, body from (${resolved}) resolved
       where ${where.join(' and ')}
       order by id
       limit $${params.push(limit + 1)}`,
      params,
    );

    const resources = rows.rows
      .slice(0, limit)
      // A record read through a module layer belongs to the world reading it,
      // so the world it reports is the world that was asked.
      .map((r) => ({ ...r.body, world: this.world }) as Resource);
    return rows.rows.length > limit
      ? { resources, next: resources[resources.length - 1]!.id }
      : { resources };
  }

  /**
   * Create or replace a resource in this world's own layer.
   *
   * The platform fields are the API's to set, not the client's: the world,
   * the transaction time and the revision are taken from the request and the
   * record already stored, so a client cannot backdate a change or claim a
   * revision it did not make.
   */
  async put(
    model: ModelId,
    id: string,
    input: Record<string, unknown>,
  ): Promise<Resource> {
    assertModel(model);
    const previous = await this.own(model, id);
    const now = new Date();
    const body = validate(model, {
      ...input,
      id,
      world: this.world,
      canonStatus: input.canonStatus ?? previous?.canonStatus ?? 'proposed',
      recorded: {
        createdAt:
          (previous?.recorded as { createdAt?: string } | undefined)
            ?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        revision:
          ((previous?.recorded as { revision?: number } | undefined)
            ?.revision ?? 0) + 1,
      },
    });
    return this.write(model, id, body, now, previous === undefined);
  }

  /** Merge fields into a stored resource. Absent fields are left alone. */
  async patch(
    model: ModelId,
    id: string,
    input: Record<string, unknown>,
  ): Promise<Resource> {
    const previous = await this.get(model, id);
    if (previous === undefined) throw new NotFoundError(model, id);
    const { recorded: _ignored, ...rest } = input;
    return this.put(model, id, { ...previous, ...rest });
  }

  /**
   * Remove a resource from this world.
   *
   * The row stays, marked deleted, for two reasons: the authoring history has
   * to remain readable through `asOf`, and a delete in a world has to be able
   * to hide a record that arrived from a module, which cannot be deleted.
   */
  async remove(model: ModelId, id: string): Promise<void> {
    assertModel(model);
    const existing = await this.get(model, id);
    if (existing === undefined) throw new NotFoundError(model, id);
    const now = new Date();
    const revision =
      ((existing.recorded as { revision?: number } | undefined)?.revision ??
        0) + 1;

    await this.client.query(
      `insert into resource (layer_id, model, id, body, recorded_at, deleted_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (layer_id, model, id)
       do update set deleted_at = $5, recorded_at = $5`,
      [this.world, model, id, existing, now],
    );
    await this.client.query(
      `insert into resource_version
         (layer_id, model, id, revision, body, recorded_at, deleted)
       values ($1, $2, $3, $4, $5, $6, true)
       on conflict (layer_id, model, id, revision) do nothing`,
      [this.world, model, id, revision, existing, now],
    );
    await this.emit(model, id, 'deleted', existing);
  }

  /**
   * Everything in this world that refers to a resource.
   *
   * The ontology is a web of references, so this is what a page about
   * something is made of: the events a person took part in, the titles they
   * held, the claims pressed on them. Asking each model in turn and filtering
   * would mean reading the world to draw one page, so the question is asked
   * once, of the reference itself.
   */
  async references(
    id: string,
    options: {
      readonly models?: readonly ModelId[];
      readonly limit?: number;
    } = {},
  ): Promise<{ model: ModelId; resource: Resource }[]> {
    if (!UUID.test(id)) {
      throw new ValidationError('a reference is looked up by uuid', [
        { path: ['id'], message: 'not a uuid' },
      ]);
    }
    const params: unknown[] = [this.world, `$.** ? (@.id == "${id}")`, id];
    const models_ =
      options.models && options.models.length > 0
        ? ` and r.model = any($${params.push(options.models)}::text[])`
        : '';
    const { rows } = await this.client.query<{
      model: ModelId;
      body: Resource;
    }>(
      `select distinct on (r.model, r.id) r.model, r.body
       from resource r
       join world_layer wl on wl.layer_id = r.layer_id
       where wl.world_id = $1
         and r.deleted_at is null
         and r.body @? $2::jsonpath
         and r.id <> $3${models_}
       order by r.model, r.id, wl.position
       limit $${params.push(Math.min(options.limit ?? 200, MAX_LIMIT))}`,
      params,
    );
    return rows.map((r) => ({
      model: r.model,
      resource: { ...r.body, world: this.world },
    }));
  }

  /**
   * Search every model at once by name.
   *
   * One search box, because a person looking for Itumeist does not know
   * whether it is a place, a title or a house, and in this ontology it is
   * likely to be all three.
   */
  async search(
    query: string,
    options: {
      readonly models?: readonly ModelId[];
      readonly limit?: number;
    } = {},
  ): Promise<
    { model: ModelId; id: string; name: string; canonStatus: string }[]
  > {
    const text = query.trim();
    if (text.length === 0) return [];
    const params: unknown[] = [this.world, `%${text}%`];
    const models_ =
      options.models && options.models.length > 0
        ? ` and r.model = any($${params.push(options.models)}::text[])`
        : '';
    const { rows } = await this.client.query<{
      model: ModelId;
      id: string;
      name: string;
      canon_status: string;
    }>(
      `select distinct on (r.model, r.id) r.model, r.id, r.name, r.canon_status
       from resource r
       join world_layer wl on wl.layer_id = r.layer_id
       where wl.world_id = $1
         and r.deleted_at is null
         and r.name ilike $2${models_}
       order by r.model, r.id, wl.position
       limit $${params.push(Math.min(options.limit ?? 50, MAX_LIMIT))}`,
      params,
    );
    return rows.map((r) => ({
      model: r.model,
      id: r.id,
      name: r.name,
      canonStatus: r.canon_status,
    }));
  }

  /**
   * Every version of a resource, newest first.
   *
   * A page that can be edited needs to show what it used to say and when it
   * changed. Reading a version back is `?asOf=` with one of these times.
   */
  async history(
    model: ModelId,
    id: string,
  ): Promise<
    {
      revision: number;
      recordedAt: string;
      deleted: boolean;
      generatedBy?: string;
    }[]
  > {
    assertModel(model);
    const { rows } = await this.client.query<{
      revision: number;
      recorded_at: Date;
      deleted: boolean;
      generated_by: string | null;
    }>(
      `select v.revision, v.recorded_at, v.deleted,
              v.body -> 'provenance' ->> 'generatedBy' as generated_by
       from resource_version v
       join world_layer wl on wl.layer_id = v.layer_id
       where wl.world_id = $1 and v.model = $2 and v.id = $3
       order by v.recorded_at desc, v.revision desc`,
      [this.world, model, id],
    );
    return rows.map((r) => ({
      revision: r.revision,
      recordedAt: r.recorded_at.toISOString(),
      deleted: r.deleted,
      ...(r.generated_by ? { generatedBy: r.generated_by } : {}),
    }));
  }

  /**
   * Store many resources at once, as a generator or a simulation produced
   * them.
   *
   * This is not `put` in a loop, and not only for speed. Generated content
   * arrives already stamped: it carries its own id, its provenance and its
   * seed, and rewriting the revision or the transaction time would lose the
   * account of how it was made. The world is still forced to this one, and
   * every resource is still validated against its schema.
   *
   * One event is emitted for the import rather than one per resource,
   * because a subscriber wants to hear that a history was written, not thirty
   * thousand times that a person was.
   */
  async import(
    resources: readonly { model: ModelId; body: Record<string, unknown> }[],
    options: { readonly summary?: string } = {},
  ): Promise<number> {
    const now = new Date();
    const rows = resources.map(({ model, body }) => {
      assertModel(model);
      const validated = validate(model, {
        ...body,
        world: this.world,
        // Content from a generator arrives stamped; content typed by a person
        // does not, and should not have to be to be saved in a batch.
        recorded: body.recorded ?? {
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          revision: 1,
        },
      });
      return {
        model,
        id: validated.id,
        body: validated,
        revision:
          (validated.recorded as { revision?: number } | undefined)?.revision ??
          1,
      };
    });

    for (let start = 0; start < rows.length; start += IMPORT_CHUNK) {
      const chunk = rows.slice(start, start + IMPORT_CHUNK);
      const modelNames = chunk.map((r) => r.model);
      const ids = chunk.map((r) => r.id);
      const bodies = chunk.map((r) => JSON.stringify(r.body));
      const revisions = chunk.map((r) => r.revision);

      await this.client.query(
        `insert into resource (layer_id, model, id, body, recorded_at)
         select $1, t.model, t.id, t.body::jsonb, $5
         from unnest($2::text[], $3::uuid[], $4::text[]) as t(model, id, body)
         on conflict (layer_id, model, id) do update
           set body = excluded.body,
               recorded_at = excluded.recorded_at,
               deleted_at = null`,
        [this.world, modelNames, ids, bodies, now],
      );
      await this.client.query(
        `insert into resource_version
           (layer_id, model, id, revision, body, recorded_at)
         select $1, t.model, t.id, t.revision, t.body::jsonb, $6
         from unnest($2::text[], $3::uuid[], $4::int[], $5::text[])
           as t(model, id, revision, body)
         on conflict (layer_id, model, id, revision) do nothing`,
        [this.world, modelNames, ids, revisions, bodies, now],
      );
    }

    await this.client.query(
      `insert into event_outbox (world_id, model, resource_id, action, envelope)
       values ($1, 'world', $1, 'updated', $2)`,
      [
        this.world,
        {
          specVersion: '1',
          type: 'opendnd.world.imported',
          world: this.world,
          count: rows.length,
          models: countBy(rows.map((r) => r.model)),
          ...(options.summary ? { summary: options.summary } : {}),
        },
      ],
    );
    return rows.length;
  }

  private async write(
    model: ModelId,
    id: string,
    body: Resource,
    now: Date,
    created: boolean,
  ): Promise<Resource> {
    await this.client.query(
      `insert into resource (layer_id, model, id, body, recorded_at)
       values ($1, $2, $3, $4, $5)
       on conflict (layer_id, model, id)
       do update set body = $4, recorded_at = $5, deleted_at = null`,
      [this.world, model, id, body, now],
    );
    await this.client.query(
      `insert into resource_version
         (layer_id, model, id, revision, body, recorded_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (layer_id, model, id, revision) do nothing`,
      [
        this.world,
        model,
        id,
        (body.recorded as { revision: number }).revision,
        body,
        now,
      ],
    );
    await this.emit(model, id, created ? 'created' : 'updated', body);
    return body;
  }

  /** This world's own version of a resource, ignoring every module layer. */
  private async own(model: ModelId, id: string): Promise<Resource | undefined> {
    const { rows } = await this.client.query<{ body: Resource }>(
      `select body from resource
       where layer_id = $1 and model = $2 and id = $3 and deleted_at is null`,
      [this.world, model, id],
    );
    return rows[0]?.body;
  }

  /**
   * Record the write for the platform bus. It goes in the same transaction as
   * the write itself, so an event cannot describe a change that was rolled
   * back and a change cannot happen without an event.
   */
  private async emit(
    model: ModelId,
    id: string,
    action: 'created' | 'updated' | 'deleted',
    body: Resource,
  ): Promise<void> {
    await this.client.query(
      `insert into event_outbox (world_id, model, resource_id, action, envelope)
       values ($1, $2, $3, $4, $5)`,
      [
        this.world,
        model,
        id,
        action,
        {
          specVersion: '1',
          type: `opendnd.${model}.${action}`,
          world: this.world,
          model,
          id,
          revision: (body.recorded as { revision?: number } | undefined)
            ?.revision,
        },
      ],
    );
  }
}

/** Validate against the model's generated schema, or say what is wrong. */
export function validate(
  model: ModelId,
  body: Record<string, unknown>,
): Resource {
  const result = models[model].safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      `${model} is not valid: ${result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      result.error.issues,
    );
  }
  return result.data as Resource;
}

export function isModel(value: string): value is ModelId {
  return Object.prototype.hasOwnProperty.call(models, value);
}

/**
 * The range of cell ids inside a cell, from its token.
 *
 * The token is the id with trailing zero nibbles removed, so padding it back
 * out recovers the number, and the level marker bit gives the size of the
 * range beneath it.
 */
export function cellRange(token: string): { min: string; max: string } {
  if (!/^[0-9a-f]{1,16}$/i.test(token)) {
    throw new ValidationError(`${token} is not a cell token`, [
      { path: ['cell'], message: 'not a cell token' },
    ]);
  }
  const id = BigInt(`0x${token.padEnd(16, '0')}`);
  /* eslint-disable-next-line no-bitwise -- isolating the level marker bit is
     what a cell id is for; there is no arithmetic way to say it */
  const lowest = id & -id;
  const min = BigInt.asIntN(64, id - (lowest - 1n));
  const max = BigInt.asIntN(64, id + (lowest - 1n));
  return { min: min.toString(), max: max.toString() };
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function assertModel(model: string): void {
  if (!isModel(model)) throw new NotFoundError('model', model);
}
