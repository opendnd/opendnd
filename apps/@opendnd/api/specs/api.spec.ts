import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Pool } from 'pg';
import { createApp } from 'src/app';
import { inWorld } from 'src/db';
import { DevIdentityResolver } from 'src/identity';
import { type OutboxEvent, publishWorld } from 'src/outbox';
import { connect } from './support';

/** The API as a caller sees it: requests in, JSON out. */
function client(app: ReturnType<typeof createApp>, subject?: string) {
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
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
    };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    delete: (p: string) => call('DELETE', p),
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
    drew = client(app, 'drew');
    stranger = client(app, 'stranger');
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
      ['drew', 'stranger'],
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
          subject: 'stranger',
          role: 'editor',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await drew.post(`/v1/worlds/${world}/members`, {
          subject: 'stranger',
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
    drew = client(app, 'drew-actions');
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
      'drew-actions',
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
      { headers: { authorization: 'Bearer dev:drew-actions' } },
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
    drew = client(app, 'drew-frontend');
    stranger = client(app, 'stranger-frontend');
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
      ['drew-frontend', 'stranger-frontend'],
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
    expect(me.subject).toBe('drew-frontend');
    expect(me.email).toBe('drew-frontend@localhost');
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
      subject: 'stranger-frontend',
      role: 'editor',
    });

    const listed = await drew.get(`/v1/worlds/${world}/members`);
    const members = (
      listed.body as {
        members: { subject: string; role: string }[];
      }
    ).members;
    expect(members.map((m) => m.subject).sort()).toEqual([
      'drew-frontend',
      'stranger-frontend',
    ]);
    // An editor cannot see who else belongs.
    expect((await stranger.get(`/v1/worlds/${world}/members`)).status).toBe(
      403,
    );

    expect(
      (await drew.delete(`/v1/worlds/${world}/members/stranger-frontend`))
        .status,
    ).toBe(204);
    expect((await stranger.get(`/v1/worlds/${world}/place`)).status).toBe(403);

    // A world with no owner is one nobody can fix, so the request is
    // refused rather than failing.
    const last = await drew.delete(`/v1/worlds/${world}/members/drew-frontend`);
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
    drew = client(app, 'drew-campaign');
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
      'drew-campaign',
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
