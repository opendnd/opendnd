import {
  type ModelId,
  models,
  readOnlyFields,
  validTimeFields,
} from '@opendnd/types';
import type { PoolClient } from 'pg';

/** A stored resource, as the API hands it out. */
export type Resource = Record<string, unknown> & {
  id: string;
  world: string;
  model?: string;
};

export interface ReadOptions {
  /** In-world time. Returns the state that held then. */
  readonly at?: number;
  /** Transaction time, ISO 8601. Returns the record as it was authored then. */
  readonly asOf?: string;
}

/** The orders a page can come in. A cursor belongs to the order it was made in. */
export type SortKey = 'id' | 'name' | 'updatedAt';

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
  /** Only these ids, which is how a page fetches what it refers to at once. */
  readonly ids?: readonly string[];
  readonly sort?: SortKey;
  readonly limit?: number;
  /** Where to continue from, taken from a previous page's `next`. */
  readonly cursor?: string;
}

export interface WriteOptions {
  /**
   * The revision the caller last read. The write is refused when the record
   * has moved on since, so two people editing the same record cannot silently
   * overwrite each other.
   */
  readonly expectedRevision?: number;
}

export interface Page {
  readonly resources: Resource[];
  /** Cursor for the next page, absent when this is the last. */
  readonly next?: string;
}

export class ValidationError extends Error {
  readonly code = 'validation';
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
  readonly code = 'conflict';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** The record has changed since the caller read it. */
export class StaleError extends Error {
  readonly code = 'stale';
  constructor(message: string) {
    super(message);
    this.name = 'StaleError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'not-found';
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
/** Postgres: unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** The column each sort order reads, and the cast its cursor needs. */
const SORTS: Record<SortKey, { column: string; cast: string }> = {
  id: { column: 'id', cast: 'uuid' },
  name: { column: 'lower(name)', cast: 'text' },
  updatedAt: { column: 'recorded_at', cast: 'timestamptz' },
};

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
    /** The request's connection, for anything else that must land in the same transaction. */
    readonly client: PoolClient,
    private readonly world: string,
  ) {}

  /** One resource, or undefined when this world has no such thing. */
  async get(
    model: ModelId,
    id: string,
    options: ReadOptions = {},
  ): Promise<Resource | undefined> {
    assertUuid(id);
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
    const limit = clampLimit(options.limit);
    const sort = options.sort ?? 'id';
    const order = SORTS[sort];
    const params: unknown[] = [this.world, model];
    const resolved =
      options.asOf === undefined
        ? `select distinct on (r.model, r.id)
             r.id, r.body, r.deleted_at, r.canon_status, r.perspective,
             r.module_digest, r.generated_by, r.name, r.valid_from, r.valid_to,
             r.cell_id, r.recorded_at
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
             null::bigint as cell_id,
             v.recorded_at
           from resource_version v
           join world_layer wl on wl.layer_id = v.layer_id
           where wl.world_id = $1 and v.model = $2
             and v.recorded_at <= $${params.push(options.asOf)}
           order by v.model, v.id, wl.position, v.revision desc`;

    const where = ['deleted_at is null'];
    if (onlyId !== undefined) where.push(`id = $${params.push(onlyId)}`);
    if (options.ids !== undefined) {
      where.push(`id = any($${params.push([...options.ids])}::uuid[])`);
    }
    if (options.cursor !== undefined) {
      const cursor = decodeCursor(options.cursor, sort);
      if (sort === 'id') {
        where.push(`id > $${params.push(cursor.id)}`);
      } else {
        where.push(
          `(${order.column}, id) > ($${params.push(cursor.key)}::${order.cast}, $${params.push(cursor.id)}::uuid)`,
        );
      }
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
      where.push(
        `name ilike $${params.push(`${escapeLike(options.name)}%`)} escape '\\'`,
      );
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

    const rows = await this.client.query<{
      id: string;
      body: Resource;
      key: unknown;
    }>(
      `select id, body, ${order.column} as key from (${resolved}) resolved
       where ${where.join(' and ')}
       order by ${order.column}, id
       limit $${params.push(limit + 1)}`,
      params,
    );

    const page = rows.rows.slice(0, limit);
    const resources = page.map((r) => this.outbound(model, r.body));
    if (rows.rows.length <= limit) return { resources };
    const last = page[page.length - 1]!;
    return { resources, next: encodeCursor(sort, last.key, last.id) };
  }

  /**
   * Create a resource that must not exist yet.
   *
   * A client that names its own id and posts twice should hear about it
   * rather than have the second post silently become an update.
   */
  async create(
    model: ModelId,
    id: string,
    input: Record<string, unknown>,
  ): Promise<Resource> {
    assertModel(model);
    assertUuid(id);
    if ((await this.own(model, id)) !== undefined) {
      throw new ConflictError(
        `a ${model} with id ${id} already exists in this world; PUT replaces it`,
      );
    }
    return this.put(model, id, input);
  }

  /**
   * Create or replace a resource in this world's own layer.
   *
   * The platform fields are the API's to set, not the client's: the world,
   * the transaction time and the revision are taken from the request and the
   * record already stored, so a client cannot backdate a change or claim a
   * revision it did not make. The revision continues from the last one ever
   * written, including a deleted record's, so history never restarts.
   */
  async put(
    model: ModelId,
    id: string,
    input: Record<string, unknown>,
    options: WriteOptions = {},
  ): Promise<Resource> {
    assertModel(model);
    assertUuid(id);
    const previous = await this.own(model, id);
    // The revision a writer names is the one this world reads, which is a
    // module's when the world has no copy of its own yet.
    const seen =
      previous ??
      (options.expectedRevision === undefined
        ? undefined
        : await this.get(model, id));
    const current = seen === undefined ? undefined : revisionOf(seen);
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== current
    ) {
      throw new StaleError(
        current === undefined
          ? `${model} ${id} has no revision in this world to match`
          : `${model} ${id} is at revision ${current}, not ${options.expectedRevision}`,
      );
    }
    const now = new Date();
    const revision = (await this.lastRevision(model, id)) + 1;
    const clean = withoutReadOnly(input);
    const body = validate(
      model,
      deriveValidTime(model, {
        ...clean,
        id,
        model,
        world: this.world,
        canonStatus: clean.canonStatus ?? previous?.canonStatus ?? 'proposed',
        recorded: {
          createdAt:
            (previous?.recorded as { createdAt?: string } | undefined)
              ?.createdAt ?? now.toISOString(),
          updatedAt: now.toISOString(),
          revision,
        },
      }),
    );
    return this.write(model, id, body, now, previous);
  }

  /**
   * Merge a patch into a stored resource, as RFC 7396 defines merging: an
   * object merges recursively, `null` removes a field, and anything else,
   * arrays included, replaces what was there.
   */
  async patch(
    model: ModelId,
    id: string,
    patch: Record<string, unknown>,
    options: WriteOptions = {},
  ): Promise<Resource> {
    assertModel(model);
    assertUuid(id);
    const previous = await this.get(model, id);
    if (previous === undefined) throw new NotFoundError(model, id);
    const merged = mergePatch(previous, patch) as Record<string, unknown>;
    return this.put(model, id, merged, options);
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
    assertUuid(id);
    const existing = await this.get(model, id);
    if (existing === undefined) throw new NotFoundError(model, id);
    const now = new Date();
    const revision = (await this.lastRevision(model, id)) + 1;
    const tombstone: Resource = {
      ...existing,
      recorded: {
        ...(existing.recorded as Record<string, unknown>),
        updatedAt: now.toISOString(),
        revision,
      },
    };
    await this.client.query(
      `insert into resource (layer_id, model, id, body, recorded_at, deleted_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (layer_id, model, id)
       do update set body = $4, deleted_at = $5, recorded_at = $5`,
      [this.world, model, id, tombstone, now],
    );
    await this.version(model, id, tombstone, now, true);
    await this.emit(model, id, 'deleted', tombstone);
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
    assertUuid(id);
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
       limit $${params.push(clampLimit(options.limit ?? 200))}`,
      params,
    );
    return rows.map((r) => ({
      model: r.model,
      resource: this.outbound(r.model, r.body),
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
    const params: unknown[] = [this.world, `%${escapeLike(text)}%`];
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
         and r.name ilike $2 escape '\\'${models_}
       order by r.model, r.id, wl.position
       limit $${params.push(clampLimit(options.limit))}`,
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
    assertUuid(id);
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
       order by v.revision desc`,
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
   * seed, and rewriting the transaction time would lose the account of how it
   * was made. The world is still forced to this one, every resource is still
   * validated against its schema, and the revision is still the store's: it
   * continues from whatever was written before under the same id, so an
   * import over an edited record does not rewind its history.
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
    // The same id twice in one batch is one record; the last one wins.
    const byKey = new Map<
      string,
      { model: ModelId; id: string; body: Resource }
    >();
    for (const { model, body } of resources) {
      assertModel(model);
      const { module: _module, ...own } = body;
      const validated = validate(
        model,
        deriveValidTime(model, {
          ...own,
          model,
          world: this.world,
          // Nor need it carry an id or say whether it is canon: an unmarked
          // record is proposed, as one created on its own is.
          id: own.id ?? crypto.randomUUID(),
          canonStatus: own.canonStatus ?? 'proposed',
          // Content from a generator arrives stamped; content typed by a
          // person does not, and should not have to be to be saved in a batch.
          recorded: own.recorded ?? {
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            revision: 1,
          },
        }),
      );
      byKey.set(`${model}/${validated.id}`, {
        model,
        id: validated.id,
        body: validated,
      });
    }
    const rows = [...byKey.values()];

    for (let start = 0; start < rows.length; start += IMPORT_CHUNK) {
      const chunk = rows.slice(start, start + IMPORT_CHUNK);
      await this.client.query(
        `with incoming as (
           select t.model, t.id, t.body::jsonb as body,
                  coalesce((select max(v.revision) from resource_version v
                            where v.layer_id = $1 and v.model = t.model and v.id = t.id), 0) + 1
                    as revision
           from unnest($2::text[], $3::uuid[], $4::text[]) as t(model, id, body)
         ), stamped as (
           select model, id, revision,
                  jsonb_set(body, '{recorded,revision}', to_jsonb(revision)) as body
           from incoming
         ), versioned as (
           insert into resource_version
             (layer_id, model, id, revision, body, recorded_at)
           select $1, model, id, revision, body, $5 from stamped
           returning model, id, body
         )
         insert into resource (layer_id, model, id, body, recorded_at)
         select $1, model, id, body, $5 from versioned
         on conflict (layer_id, model, id) do update
           set body = excluded.body,
               recorded_at = excluded.recorded_at,
               deleted_at = null`,
        [
          this.world,
          chunk.map((r) => r.model),
          chunk.map((r) => r.id),
          chunk.map((r) => JSON.stringify(r.body)),
          now,
        ],
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

  /**
   * Write a prepared body over the previous one, or in its absence.
   *
   * The update carries the revision it expects to replace, so two writers who
   * both read revision 3 cannot both produce revision 4: the second finds no
   * row at 3 and is told the record moved. The version row is a plain insert
   * for the same reason; a duplicate is a fault to report, not to swallow.
   */
  private async write(
    model: ModelId,
    id: string,
    body: Resource,
    now: Date,
    previous: Resource | undefined,
  ): Promise<Resource> {
    if (previous !== undefined) {
      const updated = await this.client.query(
        `update resource
         set body = $4, recorded_at = $5
         where layer_id = $1 and model = $2 and id = $3
           and deleted_at is null
           and (body -> 'recorded' ->> 'revision')::int = $6`,
        [this.world, model, id, body, now, revisionOf(previous)],
      );
      if (updated.rowCount === 0) {
        throw new StaleError(`${model} ${id} was changed by another request`);
      }
    } else {
      const inserted = await this.client.query(
        `insert into resource (layer_id, model, id, body, recorded_at)
         values ($1, $2, $3, $4, $5)
         on conflict (layer_id, model, id) do update
           set body = $4, recorded_at = $5, deleted_at = null
           where resource.deleted_at is not null`,
        [this.world, model, id, body, now],
      );
      if (inserted.rowCount === 0) {
        throw new ConflictError(
          `${model} ${id} was created by another request`,
        );
      }
    }
    await this.version(model, id, body, now, false);
    await this.emit(
      model,
      id,
      previous === undefined ? 'created' : 'updated',
      body,
    );
    return body;
  }

  private async version(
    model: ModelId,
    id: string,
    body: Resource,
    now: Date,
    deleted: boolean,
  ): Promise<void> {
    const revision = revisionOf(body);
    try {
      await this.client.query(
        `insert into resource_version
           (layer_id, model, id, revision, body, recorded_at, deleted)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [this.world, model, id, revision, body, now, deleted],
      );
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new StaleError(
          `${model} ${id} revision ${revision} was written by another request`,
        );
      }
      throw error;
    }
  }

  /** This world's own live version of a resource, ignoring every module layer. */
  private async own(model: ModelId, id: string): Promise<Resource | undefined> {
    const { rows } = await this.client.query<{ body: Resource }>(
      `select body from resource
       where layer_id = $1 and model = $2 and id = $3 and deleted_at is null`,
      [this.world, model, id],
    );
    return rows[0]?.body;
  }

  /** The highest revision ever written for a resource here, deleted or not. */
  private async lastRevision(model: ModelId, id: string): Promise<number> {
    const { rows } = await this.client.query<{ last: number }>(
      `select coalesce(max(revision), 0)::int as last from resource_version
       where layer_id = $1 and model = $2 and id = $3`,
      [this.world, model, id],
    );
    return rows[0]!.last;
  }

  /**
   * A record as it leaves the store. It belongs to the world reading it,
   * whichever layer it was read from, and it says which model it is.
   */
  private outbound(model: ModelId, body: Resource): Resource {
    return { ...body, model, world: this.world };
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
          revision: revisionOf(body),
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

/**
 * Fill in `validTime` from the properties the schema names for it.
 *
 * A person's life is their birth and death, a faction's its founding and
 * dissolution, an event's the span it says it happened in. Those fields carry
 * more than an interval, so they stay; but the query for "what held in year
 * Y" reads one interval, and this is what puts it there. A record that
 * states its own `validTime` is left alone.
 */
export function deriveValidTime(
  model: ModelId,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.validTime !== undefined) return body;
  const fields = (
    validTimeFields as Partial<Record<ModelId, { begin: string; end?: string }>>
  )[model];
  if (!fields) return body;
  const begin = valueAt(body, fields.begin);
  const end = fields.end === undefined ? undefined : valueAt(body, fields.end);
  if (!isPlainObject(begin) && !isPlainObject(end)) return body;
  return {
    ...body,
    validTime: {
      ...(isPlainObject(begin) ? { begin } : {}),
      ...(isPlainObject(end) ? { end } : {}),
    },
  };
}

/**
 * Apply a JSON merge patch (RFC 7396): objects merge member by member, a
 * `null` member removes the target's, and any other value replaces it.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(target)
    ? { ...target }
    : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
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

/** Drop the fields the server sets, whatever a request says about them. */
function withoutReadOnly(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...input };
  for (const field of readOnlyFields) delete out[field];
  return out;
}

function revisionOf(body: Record<string, unknown>): number {
  return (body.recorded as { revision?: number } | undefined)?.revision ?? 0;
}

function valueAt(body: unknown, path: string): unknown {
  let node: unknown = body;
  for (const segment of path.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[segment];
  }
  return node;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Make a search term literal for `like`: the wildcards and the escape itself. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function clampLimit(limit: number | undefined): number {
  const wanted = Math.trunc(limit ?? DEFAULT_LIMIT);
  return Math.min(Math.max(1, wanted), MAX_LIMIT);
}

/**
 * A cursor is the sort key and id of the last row on a page, so the next
 * page starts strictly after it whatever order the list is in. It is opaque
 * to clients and bound to its sort, because a cursor from one order says
 * nothing about a position in another.
 */
function encodeCursor(sort: SortKey, key: unknown, id: string): string {
  const k = key instanceof Date ? key.toISOString() : key;
  return Buffer.from(JSON.stringify({ s: sort, k, id })).toString('base64url');
}

function decodeCursor(
  cursor: string,
  sort: SortKey,
): { key: unknown; id: string } {
  // A bare id is the cursor an id-ordered list used to hand out.
  if (sort === 'id' && UUID.test(cursor)) return { key: cursor, id: cursor };
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { s?: string; k?: unknown; id?: string };
    if (
      parsed.s !== sort ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      throw new Error('cursor does not fit this sort');
    }
    return { key: parsed.k, id: parsed.id };
  } catch {
    throw new ValidationError(
      'the cursor is not one this list handed out for this sort',
      [{ path: ['cursor'], message: 'not a cursor for this sort' }],
    );
  }
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function assertModel(model: string): void {
  if (!isModel(model)) throw new NotFoundError('model', model);
}

function assertUuid(id: string): void {
  if (!UUID.test(id)) {
    throw new ValidationError(`${id} is not an id`, [
      { path: ['id'], message: 'not a uuid' },
    ]);
  }
}
