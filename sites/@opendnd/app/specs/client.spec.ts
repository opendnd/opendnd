import { describe, expect, it, vi } from 'vitest';
import { ApiClient, Problem } from 'src/api/client';
import { fakeFetch } from './helpers';

/** A client signed in as `ada`, or anonymous when `token` is `null`. */
function client(fetchImpl: typeof fetch, token: string | null = 'dev:ada') {
  const onUnauthorized = vi.fn();
  return {
    onUnauthorized,
    api: new ApiClient({
      baseUrl: 'http://api.test',
      authorization: async () => token ?? undefined,
      onUnauthorized,
      fetch: fetchImpl,
    }),
  };
}

describe('the API client', () => {
  it('sends the bearer token, and nothing when there is none', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/models': () => ({ models: [] }),
    });
    await client(fetch).api.models();
    await client(fetch, null).api.models();
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer dev:ada');
    expect(calls[1]!.headers.get('authorization')).toBeNull();
  });

  it('returns the ETag with a resource and sends it back as If-Match', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/worlds/w/pet/p': () =>
        Response.json(
          { id: 'p', name: 'Biscuit' },
          { headers: { etag: '"3"' } },
        ),
      'PUT /v1/worlds/w/pet/p': () =>
        Response.json({ id: 'p', name: 'Crumb' }, { headers: { etag: '"4"' } }),
    });
    const { api } = client(fetch);
    const stored = await api.get('w', 'pet', 'p');
    expect(stored.etag).toBe('"3"');
    const updated = await api.put(
      'w',
      'pet',
      'p',
      { name: 'Crumb' },
      stored.etag,
    );
    expect(updated.etag).toBe('"4"');
    expect(calls[1]!.headers.get('if-match')).toBe('"3"');
    expect(calls[1]!.headers.get('content-type')).toBe('application/json');
    expect(await calls[1]!.json()).toEqual({ name: 'Crumb' });
  });

  it('puts query parameters on the URL and leaves empty ones off', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/worlds/w/pet': () => ({ resources: [] }),
    });
    await client(fetch).api.list('w', 'pet', {
      name: 'Bis',
      at: 1041,
      cursor: undefined,
      limit: '',
    });
    expect(new URL(calls[0]!.url).search).toBe('?name=Bis&at=1041');
  });

  it('turns the problem shape into a Problem with its code and issues', async () => {
    const { fetch } = fakeFetch({
      'POST /v1/worlds/w/pet': () =>
        Response.json(
          {
            error: 'pet is not valid',
            code: 'validation',
            requestId: 'req-1',
            issues: [{ path: ['legs'], message: 'expected integer' }],
          },
          { status: 400 },
        ),
    });
    const error = await client(fetch)
      .api.create('w', 'pet', {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Problem);
    const problem = error as Problem;
    expect(problem.status).toBe(400);
    expect(problem.code).toBe('validation');
    expect(problem.message).toBe('pet is not valid');
    expect(problem.requestId).toBe('req-1');
    expect(problem.issues).toEqual([
      { path: ['legs'], message: 'expected integer' },
    ]);
    expect(problem.stale).toBe(false);
  });

  it('marks a 412 as stale', async () => {
    const { fetch } = fakeFetch({
      'PUT /v1/worlds/w/pet/p': () =>
        Response.json(
          { error: 'changed', code: 'stale', requestId: 'r' },
          { status: 412 },
        ),
    });
    const error = (await client(fetch)
      .api.put('w', 'pet', 'p', {}, '"1"')
      .catch((e: unknown) => e)) as Problem;
    expect(error.stale).toBe(true);
  });

  it('tells the application about a 401', async () => {
    const { fetch } = fakeFetch({
      'GET /v1/me': () =>
        Response.json(
          { error: 'sign in', code: 'unauthorized', requestId: 'r' },
          { status: 401 },
        ),
    });
    const { api, onUnauthorized } = client(fetch);
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('copes with an error body that is not the problem shape', async () => {
    const { fetch } = fakeFetch({
      'GET /v1/me': () =>
        new Response('<html>gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
    });
    await expect(client(fetch).api.me()).rejects.toMatchObject({
      status: 502,
      code: 'internal',
      message: 'Bad Gateway',
    });
  });

  it('reports an unreachable API as a network problem', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(client(failing).api.me()).rejects.toMatchObject({
      status: 0,
      code: 'network',
    });
  });

  it('accepts an empty answer', async () => {
    const { fetch } = fakeFetch({
      'DELETE /v1/worlds/w/pet/p': () => undefined,
    });
    await expect(
      client(fetch).api.remove('w', 'pet', 'p'),
    ).resolves.toBeUndefined();
  });

  it('searches with the query and a limit', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/worlds/w/$search': () => ({ results: [] }),
    });
    await client(fetch).api.search('w', 'Bis', 5);
    expect(new URL(calls[0]!.url).search).toBe('?q=Bis&limit=5');
  });
});

describe('the API client and the platform fetch', () => {
  it('calls the global fetch as a function, never as a method of itself', async () => {
    // A browser's fetch throws when invoked with any other receiver, which a
    // fake fetch never notices; this one insists the same way.
    const strict = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch': Illegal invocation");
      }
      return Promise.resolve(Response.json({ models: [] }));
    });
    vi.stubGlobal('fetch', strict);
    try {
      const api = new ApiClient({
        baseUrl: 'http://api.test',
        authorization: async () => undefined,
      });
      await expect(api.models()).resolves.toEqual([]);
      expect(strict).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the API client and generation', () => {
  it('generates inside a world and imports what came back', async () => {
    const generated = [
      { id: 'p1', model: 'place', name: 'Ford' },
      { id: 'q1', model: 'population' },
    ];
    const { fetch, calls } = fakeFetch({
      'POST /v1/worlds/w/place/$generate': () => ({ resources: generated }),
      'POST /v1/worlds/w/$import': () =>
        Response.json({ imported: 2, world: 'w' }, { status: 201 }),
    });
    const { api } = client(fetch);
    const resources = await api.generate('w', 'place', { tier: 'village' });
    expect(resources).toEqual(generated);
    expect(await calls[0]!.json()).toEqual({ tier: 'village' });

    const imported = await api.importResources('w', resources);
    expect(imported).toEqual({ imported: 2, world: 'w' });
    expect(await calls[1]!.json()).toEqual({ resources: generated });
  });

  it('narrows a search to the models a field allows', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/worlds/w/$search': () => ({ results: [] }),
    });
    await client(fetch).api.search('w', 'Ada', 20, ['species', 'culture']);
    expect(new URL(calls[0]!.url).search).toBe(
      '?q=Ada&limit=20&models=species%2Cculture',
    );
  });
});

describe('the API client and a world’s settings', () => {
  it('patches a world, manages members and invitations, and reads usage', async () => {
    const { fetch, calls } = fakeFetch({
      'PATCH /v1/worlds/w': () => ({
        id: 'w',
        name: 'Renamed',
        visibility: 'public',
      }),
      'POST /v1/worlds/w/members': async (request) => {
        const body = (await request.json()) as { email?: string; role: string };
        return body.email
          ? Response.json(
              { invited: body.email, role: body.role },
              { status: 202 },
            )
          : undefined;
      },
      'DELETE /v1/worlds/w/members/ada%40x': () => undefined,
      'DELETE /v1/worlds/w/invitations/sam%40example.test': () => undefined,
      'GET /v1/worlds/w/usage': () => ({
        calls: 1,
        inputTokens: 2,
        outputTokens: 3,
        costMicros: 4,
        chargeMicros: 5,
      }),
    });
    const { api } = client(fetch);

    expect(
      await api.updateWorld('w', { name: 'Renamed', summary: null }),
    ).toMatchObject({
      name: 'Renamed',
    });
    expect(await calls[0]!.json()).toEqual({ name: 'Renamed', summary: null });

    expect(
      await api.setMember('w', { email: 'sam@example.test', role: 'viewer' }),
    ).toEqual({
      invited: 'sam@example.test',
      role: 'viewer',
    });
    expect(
      await api.setMember('w', { subject: 'ada', role: 'owner' }),
    ).toBeUndefined();

    // Subjects and emails travel URL-encoded in the path.
    await api.removeMember('w', 'ada@x');
    await api.withdrawInvitation('w', 'sam@example.test');
    expect(new URL(calls[3]!.url).pathname).toBe(
      '/v1/worlds/w/members/ada%40x',
    );
    expect(new URL(calls[4]!.url).pathname).toBe(
      '/v1/worlds/w/invitations/sam%40example.test',
    );

    expect(await api.usage('w')).toEqual({
      calls: 1,
      inputTokens: 2,
      outputTokens: 3,
      costMicros: 4,
      chargeMicros: 5,
    });
  });
});

describe('the API client and simulation', () => {
  it('runs a simulation over a resource and returns what it produced', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /v1/worlds/w/place/p/$simulate': () => ({
        startYear: 1000,
        endYear: 1020,
        counts: { event: 4 },
        findings: [],
        saved: false,
        resources: [],
      }),
    });
    const result = await client(fetch).api.simulate('w', 'place', 'p', {
      years: 20,
      save: false,
    });
    expect(result.endYear).toBe(1020);
    expect(await calls[0]!.json()).toEqual({ years: 20, save: false });
  });
});

describe('the API client and writing', () => {
  it('lists the language models and asks one to write about a record', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /v1/llm': () => ({
        task: { name: 'chronicle' },
        models: [
          { id: 'm', provider: 'ollama', name: 'm:latest', local: true },
        ],
      }),
      'POST /v1/worlds/w/person/p/$author': () => ({
        work: { id: 'k', model: 'work', text: 'Words.' },
        saved: false,
        facts: ['Person: Ada'],
      }),
    });
    const { api } = client(fetch);
    expect((await api.llm()).models[0]?.id).toBe('m');
    const result = await api.author('w', 'person', 'p', { words: 100 });
    expect(result.work.text).toBe('Words.');
    expect(await calls[1]!.json()).toEqual({ words: 100 });
  });
});
