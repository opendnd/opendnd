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
