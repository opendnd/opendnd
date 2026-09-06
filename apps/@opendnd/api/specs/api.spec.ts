import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Pool } from 'pg';
import { MODEL_IDS, createApp } from 'src/app';
import { inWorld } from 'src/db';
import { DevIdentityResolver } from 'src/identity';
import { openApiDocument } from 'src/openapi';
import { type OutboxEvent, publishAll, publishWorld } from 'src/outbox';
import { connect } from './support';

/**
 * Identities for this run alone. The suite runs against the same local
 * database a developer works in, and a developer signs in as `dev:drew`; a
 * fixed subject here would count their worlds and then delete their user.
 */
const RUN = crypto.randomUUID().slice(0, 8);
const who = (name: string) => `${name}-${RUN}`;

/** The API as a caller sees it: requests in, JSON out. */
function client(app: ReturnType<typeof createApp>, subject?: string) {
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...extra,
    };
    if (subject) headers.authorization = `Bearer dev:${subject}`;
    const response = await app.request(`http://api${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined,
      headers: response.headers,
    };
  };
  type H = Record<string, string>;
  return {
    get: (p: string, h?: H) => call('GET', p, undefined, h),
    post: (p: string, b?: unknown, h?: H) => call('POST', p, b, h),
    put: (p: string, b: unknown, h?: H) => call('PUT', p, b, h),
    patch: (p: string, b: unknown, h?: H) => call('PATCH', p, b, h),
    delete: (p: string, h?: H) => call('DELETE', p, undefined, h),
  };
}

describe('the API', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let drew: ReturnType<typeof client>;
  let stranger: ReturnType<typeof client>;
  let anonymous: ReturnType<typeof client>;
  let world: string;
  const created: string[] = [];

  beforeAll(async () => {
    pool = await connect();
    app = createApp({ pool, identity: new DevIdentityResolver() });
    drew = client(app, who('drew'));
    stranger = client(app, who('stranger'));
    anonymous = client(app);

    const made = await drew.post('/v1/worlds', { name: 'Aerath' });
    world = (made.body as { id: string }).id;
    created.push(world);
  });

  afterAll(async () => {
    if (!pool) return;
    for (const id of created) {
      await pool.query('delete from layer where id = $1', [id]);
    }
    await pool.query('delete from app_user where subject = any($1)', [
      [who('drew'), who('stranger')],
    ]);
    await pool.end();
  });

  it('serves the models the ontology defines, without listing them by hand', async () => {
    const { body } = await anonymous.get('/v1/models');
    const ids = (body as { models: { id: string }[] }).models.map((m) => m.id);
    expect(ids).toContain('place');
    expect(ids).toContain('person');
    expect(ids.length).toBe(32);
  });

  it('gives a user their own worlds and no one else', async () => {
    const mine = await drew.get('/v1/worlds');
    expect((mine.body as { worlds: { id: string }[] }).worlds).toHaveLength(1);
    const theirs = await stranger.get('/v1/worlds');
    expect((theirs.body as { worlds: unknown[] }).worlds).toHaveLength(0);
    expect((await anonymous.get('/v1/worlds')).status).toBe(401);
  });

  it('records the world as a resource in its own right', async () => {
    const { body } = await drew.get(`/v1/worlds/${world}/world/${world}`);
    expect((body as { name: string }).name).toBe('Aerath');
    expect((body as { canonStatus: string }).canonStatus).toBe('canon');
  });

  it('validates a write against the model schema and says what is wrong', async () => {
    const bad = await drew.post(`/v1/worlds/${world}/place`, {
      placeType: 'not-a-place-type',
    });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toContain('placeType');
  });

  it('creates, reads, patches and deletes a resource', async () => {
    const made = await drew.post(`/v1/worlds/${world}/place`, {
      name: 'Itumeist',
      placeType: 'town',
      population: 2300,
    });
    expect(made.status).toBe(201);
    const place = made.body as {
      id: string;
      world: string;
      canonStatus: string;
      recorded: { revision: number };
    };
    // The platform fields belong to the API, not to the request.
    expect(place.world).toBe(world);
    expect(place.canonStatus).toBe('proposed');
    expect(place.recorded.revision).toBe(1);

    const read = await drew.get(`/v1/worlds/${world}/place/${place.id}`);
    expect((read.body as { name: string }).name).toBe('Itumeist');

    const patched = await drew.patch(`/v1/worlds/${world}/place/${place.id}`, {
      population: 2500,
      canonStatus: 'canon',
    });
    expect((patched.body as { population: number }).population).toBe(2500);
    expect((patched.body as { name: string }).name).toBe('Itumeist');
    expect(
      (patched.body as { recorded: { revision: number } }).recorded.revision,
    ).toBe(2);

    const listed = await drew.get(
      `/v1/worlds/${world}/place?canonStatus=canon&name=Itum`,
    );
    expect((listed.body as { resources: unknown[] }).resources).toHaveLength(1);

    expect(
      (await drew.delete(`/v1/worlds/${world}/place/${place.id}`)).status,
    ).toBe(204);
    expect(
      (await drew.get(`/v1/worlds/${world}/place/${place.id}`)).status,
    ).toBe(404);
  });

  it('keeps the authoring history readable after a change', async () => {
    const made = await drew.post(`/v1/worlds/${world}/place`, {
      name: 'Thornehold',
      placeType: 'hamlet',
      population: 120,
    });
    const id = (made.body as { id: string }).id;
    const before = new Date().toISOString();
    await drew.patch(`/v1/worlds/${world}/place/${id}`, { population: 400 });

    const now = await drew.get(`/v1/worlds/${world}/place/${id}`);
    expect((now.body as { population: number }).population).toBe(400);

    const asOf = await drew.get(
      `/v1/worlds/${world}/place/${id}?asOf=${before}`,
    );
    expect((asOf.body as { population: number }).population).toBe(120);
  });

  it('answers a read at an in-world time with the state that held then', async () => {
    // A year has to say which calendar counts it, so the calendar comes
    // first: the ontology will not accept a bare number as a date.
    const calendar = await drew.post(`/v1/worlds/${world}/calendar`, {
      name: 'Common Reckoning',
      months: [{ name: 'Year', length: 360 }],
    });
    const trs = (calendar.body as { id: string }).id;
    const tenure = await drew.post(`/v1/worlds/${world}/tenure`, {
      name: 'Count of Itumeist, Apiustu Nuriatia',
      title: { model: 'title', id: crypto.randomUUID() },
      holder: { model: 'person', id: crypto.randomUUID() },
      validTime: { begin: { trs, year: 1010 }, end: { trs, year: 1038 } },
    });
    expect(tenure.status).toBe(201);

    const during = await drew.get(`/v1/worlds/${world}/tenure?at=1020`);
    expect((during.body as { resources: unknown[] }).resources).toHaveLength(1);
    const after = await drew.get(`/v1/worlds/${world}/tenure?at=1040`);
    expect((after.body as { resources: unknown[] }).resources).toHaveLength(0);
  });

  it('will not let a stranger read or write a private world', async () => {
    expect((await stranger.get(`/v1/worlds/${world}/place`)).status).toBe(403);
    expect(
      (await stranger.post(`/v1/worlds/${world}/place`, { placeType: 'town' }))
        .status,
    ).toBe(403);
    expect((await anonymous.get(`/v1/worlds/${world}/place`)).status).toBe(401);
  });

  it('lets anyone read a public world but only members write to it', async () => {
    const made = await drew.post('/v1/worlds', {
      name: 'Shared World',
      visibility: 'public',
    });
    const shared = (made.body as { id: string }).id;
    created.push(shared);

    expect((await anonymous.get(`/v1/worlds/${shared}/place`)).status).toBe(
      200,
    );
    expect((await stranger.get(`/v1/worlds/${shared}/place`)).status).toBe(200);
    expect(
      (await stranger.post(`/v1/worlds/${shared}/place`, { placeType: 'town' }))
        .status,
    ).toBe(403);
  });

  it('lets an owner admit an editor, and no one else admit anyone', async () => {
    await stranger.get('/v1/worlds'); // so the user exists to be admitted
    expect(
      (
        await stranger.post(`/v1/worlds/${world}/members`, {
          subject: who('stranger'),
          role: 'editor',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await drew.post(`/v1/worlds/${world}/members`, {
          subject: who('stranger'),
          role: 'editor',
        })
      ).status,
    ).toBe(204);
    const written = await stranger.post(`/v1/worlds/${world}/place`, {
      name: 'Added by an editor',
      placeType: 'village',
    });
    expect(written.status).toBe(201);
  });

  it('generates without a world and without an account', async () => {
    const species = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/human.species.json`,
    ).json();
    const culture = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/culture.json`,
    ).json();

    const { status, body } = await anonymous.post('/v1/person/$generate', {
      species,
      culture,
      seedPath: 'person/1',
    });
    expect(status).toBe(200);
    const [person] = (body as { resources: { canonStatus: string }[] })
      .resources;
    expect(person.canonStatus).toBe('generated');

    // Nothing was saved: generation is an offer, not a write.
    const listed = await drew.get(`/v1/worlds/${world}/person`);
    expect((listed.body as { resources: unknown[] }).resources).toHaveLength(0);
  });

  it('generates inside a world from resources named by id', async () => {
    const species = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/human.species.json`,
    ).json();
    const culture = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/culture.json`,
    ).json();
    const savedSpecies = await drew.post(
      `/v1/worlds/${world}/species`,
      species,
    );
    const savedCulture = await drew.post(
      `/v1/worlds/${world}/culture`,
      culture,
    );

    const { status, body } = await drew.post(
      `/v1/worlds/${world}/person/$generate`,
      {
        species: (savedSpecies.body as { id: string }).id,
        culture: (savedCulture.body as { id: string }).id,
        seedPath: 'person/from-the-world',
      },
    );
    expect(status).toBe(200);
    const [person] = (body as { resources: { world: string; name: string }[] })
      .resources;
    expect(person.world).toBe(world);
    expect(person.name.length).toBeGreaterThan(0);
  });

  it('describes each model by name, and says what generates it and what that takes', async () => {
    const { body } = await anonymous.get('/v1/models');
    const models = (
      body as {
        models: {
          id: string;
          name: string;
          description?: string;
          generate?: { description: string; input: Record<string, unknown> };
        }[];
      }
    ).models;
    const person = models.find((m) => m.id === 'person')!;
    expect(person.name).toBe('Person');
    expect(person.description).toBeTruthy();
    expect(person.generate?.input).toMatchObject({
      type: 'object',
      required: ['species', 'culture'],
    });
    // A reference input says which model it points at, in the schema itself.
    const species = (person.generate!.input.properties as Record<string, any>)
      .species;
    expect(species.properties.model).toEqual({ const: 'species' });
    // Nothing generates a calendar, so its entry says so by saying nothing.
    expect(models.find((m) => m.id === 'calendar')?.generate).toBeUndefined();
  });

  it('stamps each generated resource with its model, takes references as inputs, and imports the lot', async () => {
    const species = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/human.species.json`,
    ).json();
    const culture = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/culture.json`,
    ).json();
    const calendar = await drew.post(`/v1/worlds/${world}/calendar`, {
      name: 'Common Reckoning',
      months: [{ name: 'Year', length: 360 }],
    });
    // The fixtures carry ids, and an earlier test saved them; a second post
    // of the same id is a conflict, so these are saved as new records.
    const { id: _speciesId, ...speciesBody } = species;
    const { id: _cultureId, ...cultureBody } = culture;
    const savedSpecies = await drew.post(
      `/v1/worlds/${world}/species`,
      speciesBody,
    );
    const savedCulture = await drew.post(
      `/v1/worlds/${world}/culture`,
      cultureBody,
    );
    expect([savedSpecies.status, savedCulture.status]).toEqual([201, 201]);
    const ref = (model: string, saved: { body: unknown }) => ({
      model,
      id: (saved.body as { id: string }).id,
    });

    const generated = await drew.post(`/v1/worlds/${world}/place/$generate`, {
      tier: 'village',
      species: ref('species', savedSpecies),
      culture: ref('culture', savedCulture),
      calendar: ref('calendar', calendar),
      year: 1041,
      seedPath: 'place/village-1',
    });
    expect(generated.status).toBe(200);
    const resources = (generated.body as { resources: { model: string }[] })
      .resources;
    expect(resources.map((r) => r.model).sort()).toEqual([
      'economy',
      'place',
      'population',
    ]);

    // Because each carries its model, the bundle imports as it is.
    const imported = await drew.post(`/v1/worlds/${world}/$import`, {
      resources,
    });
    expect(imported.status).toBe(201);
    expect((imported.body as { imported: number }).imported).toBe(3);
  });

  it('writes an event for every change, in the same transaction', async () => {
    // Read inside the world: the outbox is world-scoped content, so even this
    // spec cannot see another tenant's events, and neither can a subscriber.
    const rows = await inWorld(
      pool,
      world,
      async (c) =>
        (
          await c.query<{ action: string; model: string }>(
            `select action, model from event_outbox where world_id = $1
           order by seq`,
            [world],
          )
        ).rows,
    );
    const actions = rows.map((r) => `${r.model}.${r.action}`);
    expect(actions).toContain('place.created');
    expect(actions).toContain('place.updated');
    expect(actions).toContain('place.deleted');
  });

  it('refuses a model the ontology does not define', async () => {
    expect((await drew.get(`/v1/worlds/${world}/dragons`)).status).toBe(404);
  });
});

describe('the API: actions', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let drew: ReturnType<typeof client>;
  let world: string;

  beforeAll(async () => {
    pool = await connect();
    app = createApp({ pool, identity: new DevIdentityResolver() });
    drew = client(app, who('drew-actions'));
    const made = await drew.post('/v1/worlds', { name: 'Simulated Realm' });
    world = (made.body as { id: string }).id;

    // A realm to run: one kingdom of counties, generated and then kept.
    const species = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/human.species.json`,
    ).json();
    const culture = await Bun.file(
      `${__dirname}/../../../../packages/@opendnd/generators/specs/fixtures/culture.json`,
    ).json();
    const savedSpecies = await drew.post(
      `/v1/worlds/${world}/species`,
      species,
    );
    const savedCulture = await drew.post(
      `/v1/worlds/${world}/culture`,
      culture,
    );
    const calendar = await drew.post(`/v1/worlds/${world}/calendar`, {
      name: 'Common Reckoning',
      months: [{ name: 'Year', length: 360 }],
    });

    // The realm is generated through the world, naming its species, culture
    // and calendar by id, and then kept.
    const realm = await drew.post(`/v1/worlds/${world}/place/$generate`, {
      tier: 'duchy',
      population: 60000,
      year: 1000,
      species: (savedSpecies.body as { id: string }).id,
      culture: (savedCulture.body as { id: string }).id,
      calendar: (calendar.body as { id: string }).id,
      seedPath: 'realm/for-a-simulation',
    });
    for (const resource of (
      realm.body as { resources: Record<string, unknown>[] }
    ).resources) {
      const model = modelOf(resource);
      await drew.post(`/v1/worlds/${world}/${model}`, resource);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('delete from layer where id = $1', [world]);
    await pool.query('delete from app_user where subject = $1', [
      who('drew-actions'),
    ]);
    await pool.end();
  });

  it('describes itself from the ontology, with a route set per model', async () => {
    const { status, body } = await drew.get('/v1/openapi.json');
    expect(status).toBe(200);
    const doc = body as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/v1/worlds/{world}/place']).toBeDefined();
    expect(doc.paths['/v1/worlds/{world}/place/{id}']).toBeDefined();
    // The schemas are the generated ones, so the document cannot drift.
    expect(doc.components.schemas.place).toBeDefined();
    expect(
      (doc.components.schemas.place as { properties: Record<string, unknown> })
        .properties.placeType,
    ).toBeDefined();
    expect(Object.keys(doc.components.schemas).length).toBeGreaterThanOrEqual(
      16,
    );
    // A recursive shape must not leave document-local pointers behind: an
    // OpenAPI reader resolves them against the root, which has no $defs.
    expect(JSON.stringify(doc)).not.toContain('#/$defs/');
  });

  it('runs a history and returns it without saving anything', async () => {
    const { status, body } = await drew.post(
      `/v1/worlds/${world}/world/${world}/$simulate`,
      { years: 40, startYear: 1000 },
    );
    expect(status).toBe(200);
    const result = body as {
      endYear: number;
      counts: Record<string, number>;
      findings: unknown[];
      saved: boolean;
      resources: unknown[];
    };
    expect(result.endYear).toBe(1040);
    expect(result.saved).toBe(false);
    expect(result.counts.event).toBeGreaterThan(0);
    expect(result.counts.person).toBeGreaterThan(0);
    // The checker runs over what was produced, and should find nothing.
    expect(result.findings).toEqual([]);
    expect(result.resources.length).toBeGreaterThan(0);

    const stored = await drew.get(`/v1/worlds/${world}/event`);
    expect((stored.body as { resources: unknown[] }).resources).toHaveLength(0);
  });

  it('saves a history when asked, with one event for the import', async () => {
    const before = await pending(pool, world);
    const { body } = await drew.post(
      `/v1/worlds/${world}/world/${world}/$simulate`,
      { years: 40, startYear: 1000, save: true },
    );
    const result = body as { saved: boolean; counts: Record<string, number> };
    expect(result.saved).toBe(true);

    const events = await drew.get(`/v1/worlds/${world}/event?limit=500`);
    expect(
      (events.body as { resources: unknown[] }).resources.length,
    ).toBeGreaterThan(0);
    const people = await drew.get(`/v1/worlds/${world}/person?limit=500`);
    expect(
      (people.body as { resources: unknown[] }).resources.length,
    ).toBeGreaterThan(0);

    // Thousands of resources, one event: a subscriber wants to hear that a
    // history was written, not each person in it.
    const after = await pending(pool, world);
    expect(after - before).toBe(1);
  });

  it('refuses a run that is too long, or a scope with nothing in it', async () => {
    const long = await drew.post(
      `/v1/worlds/${world}/world/${world}/$simulate`,
      { years: 5000 },
    );
    expect(long.status).toBe(400);
    const person = await drew.post(
      `/v1/worlds/${world}/person/${crypto.randomUUID()}/$simulate`,
      { years: 10 },
    );
    expect(person.status).toBe(400);
    expect((person.body as { error: string }).error).toContain('a world');
  });

  it('describes the simulation for the models it runs over, and takes references for its inputs', async () => {
    const models = (
      (await drew.get('/v1/models')).body as {
        models: {
          id: string;
          simulate?: { description: string; input: Record<string, unknown> };
        }[];
      }
    ).models;
    for (const id of ['world', 'faction', 'place']) {
      const entry = models.find((m) => m.id === id)!;
      expect(entry.simulate?.input).toMatchObject({
        type: 'object',
        properties: { years: { default: 100 }, save: { default: false } },
      });
    }
    expect(models.find((m) => m.id === 'person')?.simulate).toBeUndefined();

    // The calendar may be named as a reference, as a form sends it.
    const calendars = (
      (await drew.get(`/v1/worlds/${world}/calendar`)).body as {
        resources: { id: string }[];
      }
    ).resources;
    const { status, body } = await drew.post(
      `/v1/worlds/${world}/world/${world}/$simulate`,
      {
        years: 5,
        startYear: 1000,
        calendar: { model: 'calendar', id: calendars[0]!.id },
      },
    );
    expect(status).toBe(200);
    expect((body as { endYear: number }).endYear).toBe(1005);
  });

  it('narrows a run to one house inside the realm', async () => {
    const houses = await drew.get(`/v1/worlds/${world}/faction?limit=500`);
    const all = (
      houses.body as { resources: { id: string; parent?: unknown }[] }
    ).resources;
    const vassal = all.find((f) => f.parent !== undefined)!;
    const { status, body } = await drew.post(
      `/v1/worlds/${world}/faction/${vassal.id}/$simulate`,
      { years: 20, startYear: 1000 },
    );
    expect(status).toBe(200);
    expect(
      (body as { counts: Record<string, number> }).counts.event,
    ).toBeGreaterThan(0);
  });

  it('exports the world as a bundle and as prose', async () => {
    const json = await drew.get(`/v1/worlds/${world}/$export/json`);
    expect(json.status).toBe(200);
    const bundle = json.body as {
      resourceType: string;
      total: number;
      entry: { model: string }[];
    };
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.total).toBeGreaterThan(0);
    expect(bundle.entry.some((e) => e.model === 'place')).toBe(true);

    const response = await app.request(
      `http://api/v1/worlds/${world}/$export/markdown`,
      { headers: { authorization: `Bearer dev:${who('drew-actions')}` } },
    );
    expect(response.headers.get('content-type')).toContain('text/markdown');
    const text = await response.text();
    expect(text).toContain('# Simulated Realm');
    expect(text).toContain('## History');

    const bad = await drew.get(`/v1/worlds/${world}/$export/pdf`);
    expect(bad.status).toBe(400);
  });

  it('publishes the outbox once, and claims nothing twice', async () => {
    const sink = collecting();
    const waiting = await pending(pool, world);
    expect(waiting).toBeGreaterThan(0);

    // A page at a time until the outbox is empty.
    let drained = 0;
    for (;;) {
      const published = await publishWorld(pool, world, sink);
      if (published === 0) break;
      drained += published;
    }
    expect(drained).toBe(waiting);
    expect(sink.published.length).toBe(drained);
    // Nothing is claimed twice, so a subscriber sees each write once.
    expect(new Set(sink.published.map((e) => e.seq)).size).toBe(drained);
    expect(await pending(pool, world)).toBe(0);
  });

  it('leaves events unpublished when the sink fails', async () => {
    await drew.post(`/v1/worlds/${world}/place`, {
      name: 'Somewhere New',
      placeType: 'hamlet',
    });
    const before = await pending(pool, world);
    expect(before).toBeGreaterThan(0);

    const broken = {
      publish: async () => {
        throw new Error('the bus is down');
      },
    };
    await expect(publishWorld(pool, world, broken)).rejects.toThrow(
      'the bus is down',
    );
    // Losing an event is worse than sending it twice, so nothing was marked.
    expect(await pending(pool, world)).toBe(before);
  });
});

/** A sink that keeps what it was given, without printing it. */
function collecting() {
  const published: OutboxEvent[] = [];
  return {
    published,
    publish: async (events: readonly OutboxEvent[]) => {
      published.push(...events);
    },
  };
}

/** How many events are waiting to be published for a world. */
async function pending(pool: Pool, world: string): Promise<number> {
  return inWorld(pool, world, async (c) =>
    Number(
      (
        await c.query<{ n: string }>(
          'select count(*) as n from event_outbox where published_at is null',
        )
      ).rows[0]!.n,
    ),
  );
}

/** Which model a generated resource belongs to, from the fields it carries. */
function modelOf(resource: Record<string, unknown>): string {
  if ('placeType' in resource) return 'place';
  if ('factionType' in resource) return 'faction';
  if ('rank' in resource) return 'title';
  if ('prosperity' in resource) return 'economy';
  if ('count' in resource) return 'population';
  return 'person';
}

describe('the API: what a front end needs', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let drew: ReturnType<typeof client>;
  let stranger: ReturnType<typeof client>;
  let world: string;
  let person: string;
  let place: string;

  beforeAll(async () => {
    pool = await connect();
    app = createApp({ pool, identity: new DevIdentityResolver() });
    drew = client(app, who('drew-frontend'));
    stranger = client(app, who('stranger-frontend'));
    world = (
      (await drew.post('/v1/worlds', { name: 'Aerath' })).body as {
        id: string;
      }
    ).id;

    place = (
      (
        await drew.post(`/v1/worlds/${world}/place`, {
          name: 'Itumeist',
          placeType: 'town',
          // A cell deep in the quadtree, so a coarse cell should contain it.
          cell: '502206e25c3',
        })
      ).body as { id: string }
    ).id;
    person = (
      (
        await drew.post(`/v1/worlds/${world}/person`, {
          name: 'Ociaman Nuriatia',
          residence: { model: 'place', id: place },
        })
      ).body as { id: string }
    ).id;
    const title = await drew.post(`/v1/worlds/${world}/title`, {
      name: 'Count of Itumeist',
      rank: 2,
      successionLaw: 'male-preference',
      faction: { model: 'faction', id: crypto.randomUUID() },
    });
    // Asserted here so a schema this setup does not satisfy fails loudly
    // rather than confusing an assertion further down.
    expect(title.status).toBe(201);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('delete from layer where id = $1', [world]);
    await pool.query('delete from app_user where subject = any($1)', [
      [who('drew-frontend'), who('stranger-frontend')],
    ]);
    await pool.end();
  });

  it('tells an application who the caller is and what they may open, in one request', async () => {
    const { body } = await drew.get('/v1/me');
    const me = body as {
      subject: string;
      email: string;
      worlds: { id: string; role: string }[];
    };
    expect(me.subject).toBe(who('drew-frontend'));
    expect(me.email).toBe(`${who('drew-frontend')}@dev.invalid`);
    expect(me.worlds.find((w) => w.id === world)?.role).toBe('owner');
    expect((await client(app).get('/v1/me')).status).toBe(401);
  });

  it('serves the code lists with their display text, for a form', async () => {
    const { body } = await client(app).get('/v1/vocabularies');
    const vocabularies = (body as { vocabularies: Record<string, unknown> })
      .vocabularies;
    const prosperity = vocabularies.prosperity as {
      name: string;
      codes: { code: string; display: string }[];
    };
    // A person should see "Very poor", not `very-poor`, and the labels should
    // come from the ontology rather than from a copy in the client.
    expect(prosperity.codes).toContainEqual({
      code: 'very-poor',
      display: 'Very poor',
    });
    expect(Object.keys(vocabularies).length).toBeGreaterThan(15);
  });

  it('saves a thousand resources in one request rather than a thousand', async () => {
    const resources = Array.from({ length: 250 }, (_, i) => ({
      model: 'place',
      resource: {
        id: crypto.randomUUID(),
        name: `Hamlet ${i}`,
        placeType: 'hamlet',
        canonStatus: 'generated',
      },
    }));
    const { status, body } = await drew.post(`/v1/worlds/${world}/$import`, {
      resources,
    });
    expect(status).toBe(201);
    expect((body as { imported: number }).imported).toBe(250);

    const listed = await drew.get(
      `/v1/worlds/${world}/place?name=Hamlet&limit=500`,
    );
    expect((listed.body as { resources: unknown[] }).resources.length).toBe(
      250,
    );
  });

  it('refuses a batch naming a model the ontology does not define, and writes none of it', async () => {
    const before = await drew.get(`/v1/worlds/${world}/person?limit=500`);
    const { status } = await drew.post(`/v1/worlds/${world}/$import`, {
      resources: [
        {
          model: 'person',
          resource: { name: 'Would Be Kept', canonStatus: 'canon' },
        },
        { model: 'dragon', resource: { name: 'Not A Model' } },
      ],
    });
    expect(status).toBe(400);
    const after = await drew.get(`/v1/worlds/${world}/person?limit=500`);
    // A batch lands whole or not at all.
    expect((after.body as { resources: unknown[] }).resources.length).toBe(
      (before.body as { resources: unknown[] }).resources.length,
    );
  });

  it('finds what refers to a resource, which is what a page is made of', async () => {
    const { body } = await drew.get(
      `/v1/worlds/${world}/place/${place}/references`,
    );
    const references = (
      body as {
        references: { model: string; resource: { id: string } }[];
      }
    ).references;
    // The person lives there, so their record points at the place.
    expect(references).toHaveLength(1);
    expect(references[0]!.model).toBe('person');
    expect(references[0]!.resource.id).toBe(person);

    // A resource does not refer to itself just by carrying its own id.
    const own = await drew.get(
      `/v1/worlds/${world}/person/${person}/references`,
    );
    expect((own.body as { references: unknown[] }).references).toHaveLength(0);
  });

  it('searches every model at once, and can be narrowed to some', async () => {
    const all = await drew.get(`/v1/worlds/${world}/$search?q=itum`);
    const results = (
      all.body as {
        results: { model: string; name: string }[];
      }
    ).results;
    // "itum" is a place and a title here, and a search box should say so.
    expect(new Set(results.map((r) => r.model))).toEqual(
      new Set(['place', 'title']),
    );

    const narrowed = await drew.get(
      `/v1/worlds/${world}/$search?q=itum&models=title`,
    );
    expect(
      (narrowed.body as { results: { model: string }[] }).results.every(
        (r) => r.model === 'title',
      ),
    ).toBe(true);

    // Substring, not prefix: nobody types the beginning of a name.
    const middle = await drew.get(`/v1/worlds/${world}/$search?q=umeis`);
    expect(
      (middle.body as { results: unknown[] }).results.length,
    ).toBeGreaterThan(0);
  });

  it('lists the versions of a record, so a page can show its history', async () => {
    await drew.patch(`/v1/worlds/${world}/place/${place}`, {
      population: 2300,
    });
    await drew.patch(`/v1/worlds/${world}/place/${place}`, {
      population: 2500,
    });
    const { body } = await drew.get(
      `/v1/worlds/${world}/place/${place}/history`,
    );
    const history = (
      body as {
        history: { revision: number; recordedAt: string }[];
      }
    ).history;
    expect(history.map((h) => h.revision)).toEqual([3, 2, 1]);
    // Each entry is a time to read the record back at.
    const old = await drew.get(
      `/v1/worlds/${world}/place/${place}?asOf=${history[2]!.recordedAt}`,
    );
    expect((old.body as { population?: number }).population).toBeUndefined();
  });

  it('answers what is inside a map cell, at any zoom', async () => {
    // A coarse cell containing the town, which is stored eleven levels down.
    const inside = await drew.get(
      `/v1/worlds/${world}/place?cell=50221&limit=500`,
    );
    const names = (
      inside.body as { resources: { name: string }[] }
    ).resources.map((r) => r.name);
    expect(names).toContain('Itumeist');
    // The hamlets from the batch carry no cell, so they are not in view.
    expect(names.every((n) => !n.startsWith('Hamlet'))).toBe(true);

    // A cell elsewhere on the planet contains nothing of ours.
    const elsewhere = await drew.get(
      `/v1/worlds/${world}/place?cell=1&limit=500`,
    );
    expect(
      (elsewhere.body as { resources: { name: string }[] }).resources.some(
        (r) => r.name === 'Itumeist',
      ),
    ).toBe(false);

    const nonsense = await drew.get(`/v1/worlds/${world}/place?cell=zzz`);
    expect(nonsense.status).toBe(400);
  });

  it('reports what a world has spent on model calls', async () => {
    const { body } = await drew.get(`/v1/worlds/${world}/usage`);
    expect(body).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      chargeMicros: 0,
    });
  });

  it('lets an owner see and remove members, and keeps the last owner', async () => {
    await stranger.get('/v1/me');
    await drew.post(`/v1/worlds/${world}/members`, {
      subject: who('stranger-frontend'),
      role: 'editor',
    });

    const listed = await drew.get(`/v1/worlds/${world}/members`);
    const members = (
      listed.body as {
        members: { subject: string; role: string }[];
      }
    ).members;
    expect(members.map((m) => m.subject).sort()).toEqual([
      who('drew-frontend'),
      who('stranger-frontend'),
    ]);
    // An editor cannot see who else belongs.
    expect((await stranger.get(`/v1/worlds/${world}/members`)).status).toBe(
      403,
    );

    expect(
      (
        await drew.delete(
          `/v1/worlds/${world}/members/${who('stranger-frontend')}`,
        )
      ).status,
    ).toBe(204);
    expect((await stranger.get(`/v1/worlds/${world}/place`)).status).toBe(403);

    // A world with no owner is one nobody can fix, so the request is
    // refused rather than failing.
    const last = await drew.delete(
      `/v1/worlds/${world}/members/${who('drew-frontend')}`,
    );
    expect(last.status).toBe(409);
    expect((last.body as { error: string }).error).toContain(
      'at least one owner',
    );
  });

  it('archives a world without destroying what is in it', async () => {
    const made = await drew.post('/v1/worlds', { name: 'Abandoned' });
    const id = (made.body as { id: string }).id;
    await drew.post(`/v1/worlds/${id}/place`, {
      name: 'Still Here',
      placeType: 'village',
    });

    expect((await drew.delete(`/v1/worlds/${id}`)).status).toBe(204);
    const mine = await drew.get('/v1/worlds');
    expect(
      (mine.body as { worlds: { id: string }[] }).worlds.some(
        (w) => w.id === id,
      ),
    ).toBe(false);
    // Archived, not deleted: the content is still there to publish or restore.
    // Counted inside the world, because the policies hide it from outside.
    const remaining = await inWorld(pool, id, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'select count(*) as n from resource where layer_id = $1',
            [id],
          )
        ).rows[0]!.n,
      ),
    );
    expect(remaining).toBeGreaterThan(0);
    await pool.query('delete from layer where id = $1', [id]);
  });
});

describe('the API: the campaign layer', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let drew: ReturnType<typeof client>;
  let world: string;

  beforeAll(async () => {
    pool = await connect();
    app = createApp({ pool, identity: new DevIdentityResolver() });
    drew = client(app, who('drew-campaign'));
    world = (
      (await drew.post('/v1/worlds', { name: 'Aerath' })).body as {
        id: string;
      }
    ).id;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('delete from layer where id = $1', [world]);
    await pool.query('delete from app_user where subject = $1', [
      who('drew-campaign'),
    ]);
    await pool.end();
  });

  it('serves the campaign models without the API naming any of them', async () => {
    const { body } = await drew.get('/v1/models');
    const ids = (body as { models: { id: string }[] }).models.map((m) => m.id);
    // Adding a model to the ontology added its route set. Nothing in the API
    // changed to make these work.
    for (const model of [
      'campaign',
      'session',
      'character',
      'quest',
      'encounter',
    ]) {
      expect(ids).toContain(model);
    }
  });

  it('reuses what the world layer already has for dungeons and parties', async () => {
    // A dungeon is a place and a party is a faction. Neither needed a model.
    const dungeon = await drew.post(`/v1/worlds/${world}/place`, {
      name: 'The Sunken Vault',
      placeType: 'dungeon',
    });
    expect(dungeon.status).toBe(201);
    const party = await drew.post(`/v1/worlds/${world}/faction`, {
      name: 'The Kaviapat Four',
      factionType: 'party',
    });
    expect(party.status).toBe(201);
  });

  it('records a campaign, and everything hanging off it', async () => {
    const person = (
      (await drew.post(`/v1/worlds/${world}/person`, { name: 'Ociaman' }))
        .body as { id: string }
    ).id;
    const campaign = await drew.post(`/v1/worlds/${world}/campaign`, {
      name: 'The Itumeist Succession',
      status: 'running',
      players: ['drew', 'sam'],
      beganOn: '2026-01-10',
    });
    expect(campaign.status).toBe(201);
    // Play is not part of the fiction, and the record says so on its own.
    expect((campaign.body as { perspective: string }).perspective).toBe(
      'out-of-universe',
    );
    const campaignId = (campaign.body as { id: string }).id;

    const character = await drew.post(`/v1/worlds/${world}/character`, {
      name: 'Ociaman, of the Kaviapat Four',
      status: 'active',
      level: 3,
      person: { model: 'person', id: person },
      campaign: { model: 'campaign', id: campaignId },
      player: 'sam',
    });
    expect(character.status).toBe(201);

    const quest = await drew.post(`/v1/worlds/${world}/quest`, {
      name: 'Recover the Vault Seal',
      status: 'active',
      campaign: { model: 'campaign', id: campaignId },
      objectives: [
        { summary: 'Reach the vault', done: true },
        { summary: 'Find the seal' },
      ],
    });
    expect(quest.status).toBe(201);
    expect(
      (quest.body as { objectives: { done?: boolean }[] }).objectives.filter(
        (o) => o.done,
      ),
    ).toHaveLength(1);

    // A campaign's page is assembled from what points at it, which the
    // reference lookup finds without knowing these models exist.
    const references = await drew.get(
      `/v1/worlds/${world}/campaign/${campaignId}/references`,
    );
    expect(
      (references.body as { references: { model: string }[] }).references
        .map((r) => r.model)
        .sort(),
    ).toEqual(['character', 'quest']);
  });

  it('keeps what was prepared apart from what happened', async () => {
    const calendar = (
      (
        await drew.post(`/v1/worlds/${world}/calendar`, {
          name: 'Common Reckoning',
          months: [{ name: 'Year', length: 360 }],
        })
      ).body as { id: string }
    ).id;
    const place = (
      (
        await drew.post(`/v1/worlds/${world}/place`, {
          name: 'The Antechamber',
          placeType: 'room',
        })
      ).body as { id: string }
    ).id;

    const encounter = await drew.post(`/v1/worlds/${world}/encounter`, {
      name: 'Ambush in the antechamber',
      difficulty: 'hard',
      place: { model: 'place', id: place },
      cell: '502206e25c3',
    });
    expect(encounter.status).toBe(201);
    expect((encounter.body as { perspective: string }).perspective).toBe(
      'out-of-universe',
    );

    // Playing it produces an event, which is in-universe and dated in the
    // world's own calendar. The encounter stays as the thing set up.
    const event = await drew.post(`/v1/worlds/${world}/event`, {
      name: 'The antechamber ambush',
      eventType: 'battle',
      when: { begin: { trs: calendar, year: 1038 } },
      locations: [{ model: 'place', id: place }],
    });
    expect(event.status).toBe(201);
    expect((event.body as { perspective: string }).perspective).toBe(
      'in-universe',
    );

    const played = await drew.patch(
      `/v1/worlds/${world}/encounter/${(encounter.body as { id: string }).id}`,
      { played: { model: 'event', id: (event.body as { id: string }).id } },
    );
    expect(played.status).toBe(200);

    // The encounter is on the battle map, so a map query in view finds it.
    const inView = await drew.get(`/v1/worlds/${world}/encounter?cell=50221`);
    expect((inView.body as { resources: unknown[] }).resources).toHaveLength(1);
  });

  it('dates a session in real time and points it at what it produced', async () => {
    const campaign = (
      (
        await drew.post(`/v1/worlds/${world}/campaign`, {
          name: 'A Second Table',
          status: 'planned',
        })
      ).body as { id: string }
    ).id;
    const events = await drew.get(`/v1/worlds/${world}/event`);
    const produced = (
      events.body as { resources: { id: string }[] }
    ).resources.map((e) => ({ model: 'event', id: e.id }));

    const session = await drew.post(`/v1/worlds/${world}/session`, {
      name: 'Session 4',
      campaign: { model: 'campaign', id: campaign },
      number: 4,
      playedOn: '2026-02-14T19:00:00Z',
      durationMinutes: 210,
      attended: ['drew', 'sam'],
      recap: 'They reached the vault and were ambushed in the antechamber.',
      produced,
    });
    expect(session.status).toBe(201);
    // A session is dated when it was played, not in the calendar of the
    // fiction, which is why it is a model of its own.
    expect((session.body as { playedOn: string }).playedOn).toBe(
      '2026-02-14T19:00:00Z',
    );
    expect(
      (session.body as { produced: unknown[] }).produced.length,
    ).toBeGreaterThan(0);
  });
});

describe('the API: hardening', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let drew: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  let anonymous: ReturnType<typeof client>;
  let world: string;
  const created: string[] = [];
  const subjects = [who('drew-h'), who('other-h'), who('newcomer-h')];
  const trs = 'c0000000-0000-4000-8000-000000000001';

  const makeWorld = async (body: Record<string, unknown>) => {
    const made = await drew.post('/v1/worlds', body);
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    created.push(id);
    return id;
  };

  beforeAll(async () => {
    pool = await connect();
    app = createApp({ pool, identity: new DevIdentityResolver() });
    drew = client(app, who('drew-h'));
    other = client(app, who('other-h'));
    anonymous = client(app);
    world = await makeWorld({ name: 'Hardened' });
  });

  afterAll(async () => {
    if (!pool) return;
    for (const id of created) {
      await pool.query('delete from layer where id = $1', [id]);
    }
    await pool.query('delete from app_user where subject = any($1)', [
      subjects,
    ]);
    await pool.end();
  });

  it('refuses a malformed parameter with a 400 and a code, not a database error', async () => {
    for (const path of [
      `/v1/worlds/${world}/place?limit=0`,
      `/v1/worlds/${world}/place?limit=abc`,
      `/v1/worlds/${world}/place?at=soon`,
      `/v1/worlds/${world}/place?asOf=yesterday`,
      `/v1/worlds/${world}/place?cell=xyz`,
      `/v1/worlds/${world}/place/not-an-id`,
      '/v1/worlds/not-a-world/place',
    ]) {
      const { status, body } = await drew.get(path);
      const problem = body as { code: string; requestId: string };
      expect([path, status]).toEqual([path, 400]);
      expect(problem.code).toBe('validation');
      expect(typeof problem.requestId).toBe('string');
    }
  });

  it('answers with the revision as an ETag and refuses a write that has not seen it', async () => {
    const made = await drew.post(`/v1/worlds/${world}/place`, {
      name: 'Itumeist',
      placeType: 'town',
    });
    expect(made.status).toBe(201);
    expect(made.headers.get('etag')).toBe('"1"');
    const id = (made.body as { id: string }).id;

    const replaced = await drew.put(
      `/v1/worlds/${world}/place/${id}`,
      { name: 'Itumeist', placeType: 'city' },
      { 'if-match': '"1"' },
    );
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get('etag')).toBe('"2"');

    // A second editor who still holds revision 1 does not overwrite the city.
    const stale = await drew.put(
      `/v1/worlds/${world}/place/${id}`,
      { name: 'Itumeist', placeType: 'village' },
      { 'if-match': '"1"' },
    );
    expect(stale.status).toBe(412);
    expect((stale.body as { code: string }).code).toBe('stale');
    const now = await drew.get(`/v1/worlds/${world}/place/${id}`);
    expect((now.body as { placeType: string }).placeType).toBe('city');
    expect(now.headers.get('etag')).toBe('"2"');

    const nonsense = await drew.put(
      `/v1/worlds/${world}/place/${id}`,
      { name: 'Itumeist', placeType: 'city' },
      { 'if-match': 'whenever' },
    );
    expect(nonsense.status).toBe(400);
  });

  it('answers a second POST of the same id with a conflict, not a quiet replacement', async () => {
    const id = crypto.randomUUID();
    const first = await drew.post(`/v1/worlds/${world}/place`, {
      id,
      name: 'Once',
      placeType: 'village',
    });
    expect(first.status).toBe(201);
    const second = await drew.post(`/v1/worlds/${world}/place`, {
      id,
      name: 'Twice',
      placeType: 'village',
    });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('conflict');
    const kept = await drew.get(`/v1/worlds/${world}/place/${id}`);
    expect((kept.body as { name: string }).name).toBe('Once');
  });

  it('continues the revision after a delete, so a history never restarts', async () => {
    const id = crypto.randomUUID();
    await drew.post(`/v1/worlds/${world}/place`, {
      id,
      name: 'Phoenix',
      placeType: 'village',
    });
    expect((await drew.delete(`/v1/worlds/${world}/place/${id}`)).status).toBe(
      204,
    );
    const again = await drew.post(`/v1/worlds/${world}/place`, {
      id,
      name: 'Phoenix, rebuilt',
      placeType: 'town',
    });
    expect(again.status).toBe(201);
    expect(again.headers.get('etag')).toBe('"3"');

    const history = await drew.get(`/v1/worlds/${world}/place/${id}/history`);
    const versions = (
      history.body as { history: { revision: number; deleted: boolean }[] }
    ).history;
    expect(versions.map((v) => [v.revision, v.deleted])).toEqual([
      [3, false],
      [2, true],
      [1, false],
    ]);
  });

  it('applies a merge patch: null clears a field and objects merge', async () => {
    const made = await drew.post(`/v1/worlds/${world}/place`, {
      name: 'Patched',
      placeType: 'village',
      description: 'to be removed',
      validTime: { begin: { trs, year: 100 } },
    });
    const id = (made.body as { id: string }).id;
    const patched = await drew.patch(`/v1/worlds/${world}/place/${id}`, {
      description: null,
      validTime: { end: { trs, year: 200 } },
    });
    expect(patched.status).toBe(200);
    const body = patched.body as {
      description?: string;
      validTime: { begin?: { year: number }; end?: { year: number } };
    };
    expect(body.description).toBeUndefined();
    expect(body.validTime.begin?.year).toBe(100);
    expect(body.validTime.end?.year).toBe(200);
  });

  it('derives the valid time from birth and death, so a read at a year sees who was alive', async () => {
    const elder = await drew.post(`/v1/worlds/${world}/person`, {
      name: 'Apiustu',
      birth: { time: { trs, year: 900 } },
      death: { time: { trs, year: 950 } },
    });
    expect(elder.status).toBe(201);
    expect(
      (
        elder.body as {
          validTime: { begin: { year: number }; end: { year: number } };
        }
      ).validTime,
    ).toMatchObject({ begin: { year: 900 }, end: { year: 950 } });
    await drew.post(`/v1/worlds/${world}/person`, {
      name: 'Ociaman',
      birth: { time: { trs, year: 990 } },
    });

    const names = async (at: number) =>
      (
        (await drew.get(`/v1/worlds/${world}/person?at=${at}`)).body as {
          resources: { name: string }[];
        }
      ).resources.map((p) => p.name);
    expect(await names(920)).toEqual(['Apiustu']);
    expect(await names(1000)).toEqual(['Ociaman']);
    expect(await names(800)).toEqual([]);
  });

  it('sorts a page by name, continues it, and fetches a set of ids at once', async () => {
    const orchard = await makeWorld({ name: 'Orchard' });
    const ids: Record<string, string> = {};
    for (const name of ['Cedar', 'Ash', 'Birch']) {
      const made = await drew.post(`/v1/worlds/${orchard}/place`, {
        name,
        placeType: 'village',
      });
      ids[name] = (made.body as { id: string }).id;
    }
    const first = await drew.get(
      `/v1/worlds/${orchard}/place?sort=name&limit=2`,
    );
    const page = first.body as { resources: { name: string }[]; next?: string };
    expect(page.resources.map((p) => p.name)).toEqual(['Ash', 'Birch']);
    expect(page.next).toBeDefined();
    const second = await drew.get(
      `/v1/worlds/${orchard}/place?sort=name&limit=2&cursor=${page.next}`,
    );
    expect(
      (
        second.body as { resources: { name: string }[]; next?: string }
      ).resources.map((p) => p.name),
    ).toEqual(['Cedar']);
    // A cursor from one order is refused by another.
    expect(
      (
        await drew.get(
          `/v1/worlds/${orchard}/place?sort=id&cursor=${page.next}`,
        )
      ).status,
    ).toBe(400);

    const some = await drew.get(
      `/v1/worlds/${orchard}/place?ids=${ids.Ash},${ids.Cedar}`,
    );
    expect(
      (some.body as { resources: { name: string }[] }).resources
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Ash', 'Cedar']);
  });

  it('keeps what a world has spent to its owners, even on a public world', async () => {
    const shared = await makeWorld({ name: 'Shared', visibility: 'public' });
    expect((await anonymous.get(`/v1/worlds/${shared}/usage`)).status).toBe(
      401,
    );
    expect((await other.get(`/v1/worlds/${shared}/usage`)).status).toBe(403);
    expect((await drew.get(`/v1/worlds/${shared}/usage`)).status).toBe(200);
    // And `link` is no longer a visibility that means nothing.
    expect(
      (await drew.post('/v1/worlds', { name: 'Linked', visibility: 'link' }))
        .status,
    ).toBe(400);
  });

  it('will not let the last owner demote themself', async () => {
    const demoted = await drew.post(`/v1/worlds/${world}/members`, {
      subject: who('drew-h'),
      role: 'editor',
    });
    expect(demoted.status).toBe(409);
    expect(
      (await drew.post(`/v1/worlds/${world}/members`, { role: 'editor' }))
        .status,
    ).toBe(400);
  });

  it('invites by email and seats the person the first time they sign in', async () => {
    const invited = await drew.post(`/v1/worlds/${world}/members`, {
      email: `Newcomer-H-${RUN}@dev.invalid`,
      role: 'editor',
    });
    expect(invited.status).toBe(202);
    const before = await drew.get(`/v1/worlds/${world}/members`);
    expect(
      (before.body as { invitations: { email: string }[] }).invitations.map(
        (i) => i.email,
      ),
    ).toEqual([`${who('newcomer-h')}@dev.invalid`]);

    const newcomer = client(app, who('newcomer-h'));
    const me = await newcomer.get('/v1/me');
    expect(
      (me.body as { worlds: { id: string; role: string }[] }).worlds,
    ).toContainEqual(expect.objectContaining({ id: world, role: 'editor' }));
    const after = await drew.get(`/v1/worlds/${world}/members`);
    const body = after.body as {
      members: { subject: string; role: string }[];
      invitations: unknown[];
    };
    expect(body.invitations).toEqual([]);
    expect(body.members).toContainEqual(
      expect.objectContaining({ subject: who('newcomer-h'), role: 'editor' }),
    );
  });

  it('lets an owner change a world’s name, visibility and summary, and its record follows', async () => {
    const id = await makeWorld({ name: 'Provisional', summary: 'A draft.' });

    const changed = await drew.patch(`/v1/worlds/${id}`, {
      name: 'Settled',
      visibility: 'public',
      summary: 'No longer a draft.',
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      id,
      name: 'Settled',
      visibility: 'public',
      role: 'owner',
    });

    // The tenancy and the world's own record agree.
    const listed = (
      (await drew.get('/v1/me')).body as {
        worlds: { id: string; name: string }[];
      }
    ).worlds.find((w) => w.id === id);
    expect(listed?.name).toBe('Settled');
    const record = (await drew.get(`/v1/worlds/${id}/world/${id}`)).body as {
      name: string;
      summary?: string;
    };
    expect(record.name).toBe('Settled');
    expect(record.summary).toBe('No longer a draft.');

    // Clearing the summary is a null, as a merge patch says it.
    const cleared = await drew.patch(`/v1/worlds/${id}`, { summary: null });
    expect(cleared.status).toBe(200);
    const after = (await drew.get(`/v1/worlds/${id}/world/${id}`)).body as {
      summary?: string;
    };
    expect(after.summary).toBeUndefined();

    // Nothing to change is a 400, not a silent no-op.
    expect((await drew.patch(`/v1/worlds/${id}`, {})).status).toBe(400);
    expect(
      (await drew.patch(`/v1/worlds/${id}`, { visibility: 'link' })).status,
    ).toBe(400);

    // An editor may write content, not the world itself.
    await other.get('/v1/me');
    await drew.post(`/v1/worlds/${id}/members`, {
      subject: who('other-h'),
      role: 'editor',
    });
    expect(
      (await other.patch(`/v1/worlds/${id}`, { name: 'Mine now' })).status,
    ).toBe(403);
  });

  it('lets an owner withdraw an invitation that has not been taken up', async () => {
    const email = `${who('never-h')}@dev.invalid`;
    const invited = await drew.post(`/v1/worlds/${world}/members`, {
      email,
      role: 'viewer',
    });
    expect(invited.status).toBe(202);
    const pending = (await drew.get(`/v1/worlds/${world}/members`)).body as {
      invitations: { email: string }[];
    };
    expect(pending.invitations.map((i) => i.email)).toContain(email);

    const path = `/v1/worlds/${world}/invitations/${encodeURIComponent(email)}`;
    expect((await drew.delete(path)).status).toBe(204);
    const gone = (await drew.get(`/v1/worlds/${world}/members`)).body as {
      invitations: { email: string }[];
    };
    expect(gone.invitations.map((i) => i.email)).not.toContain(email);
    expect((await drew.delete(path)).status).toBe(404);
  });

  it('lets an owner list archived worlds and restore one', async () => {
    const attic = await makeWorld({ name: 'Attic' });
    expect((await drew.delete(`/v1/worlds/${attic}`)).status).toBe(204);
    const listed = (await drew.get('/v1/worlds')).body as {
      worlds: { id: string }[];
    };
    expect(listed.worlds.some((w) => w.id === attic)).toBe(false);
    const archived = (await drew.get('/v1/worlds?archived=true')).body as {
      worlds: { id: string; archivedAt?: string }[];
    };
    expect(
      archived.worlds.find((w) => w.id === attic)?.archivedAt,
    ).toBeDefined();
    expect((await drew.get(`/v1/worlds/${attic}/place`)).status).toBe(404);

    // Not the owner: refused, like any other change to the world.
    expect((await other.post(`/v1/worlds/${attic}/$restore`)).status).toBe(403);
    expect((await drew.post(`/v1/worlds/${attic}/$restore`)).status).toBe(204);
    expect((await drew.get(`/v1/worlds/${attic}/place`)).status).toBe(200);
  });

  it('bounds what an anonymous caller may generate', async () => {
    const realm = await anonymous.post('/v1/place/$generate', {
      tier: 'kingdom',
    });
    expect(realm.status).toBe(400);
    expect((realm.body as { code: string }).code).toBe('validation');
  });

  it('drains every world from outside any world, as the publisher does', async () => {
    const published: OutboxEvent[] = [];
    const sink = {
      publish: async (events: readonly OutboxEvent[]) => {
        published.push(...events);
      },
    };
    let drained = 0;
    for (let i = 0; i < 50; i++) {
      const n = await publishAll(pool, sink);
      if (n === 0) break;
      drained += n;
    }
    expect(drained).toBeGreaterThan(0);
    expect(published.some((e) => e.world === world)).toBe(true);
    const { rows } = await inWorld(pool, world, (c) =>
      c.query<{ n: string }>(
        'select count(*) as n from event_outbox where published_at is null',
      ),
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('describes every route it mounts, and asks a client only for what it may send', () => {
    const doc = openApiDocument();
    const documented = doc.paths as Record<string, Record<string, unknown>>;
    for (const route of app.routes) {
      if (route.method === 'ALL') continue;
      const path = route.path.replace(/:(\w+)/g, '{$1}');
      const candidates = path.includes('{model}')
        ? [path, ...MODEL_IDS.map((id) => path.replace('{model}', id))]
        : [path];
      const found = candidates.filter((p) => documented[p] !== undefined);
      expect([route.method, path, found.length > 0]).toEqual([
        route.method,
        path,
        true,
      ]);
      const method = route.method.toLowerCase();
      expect(found.some((p) => documented[p]![method] !== undefined)).toBe(
        true,
      );
    }
    const schemas = doc.components.schemas as Record<
      string,
      { properties?: Record<string, unknown>; required?: string[] }
    >;
    expect(schemas.person!.properties!.id).toBeDefined();
    expect(schemas.personInput!.properties!.id).toBeUndefined();
    expect(schemas.personInput!.required ?? []).not.toContain('world');
    expect(schemas.personInput!.required ?? []).not.toContain('recorded');
  });

  it('reports the database in its health check', async () => {
    const health = await anonymous.get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, database: 'ok' });
  });
});
