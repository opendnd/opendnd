import type {
  HistoryEntry,
  Me,
  Member,
  ModelInfo,
  Page,
  ReferenceHit,
  Resource,
  SearchHit,
  Vocabulary,
  World,
} from './types';

/** What the API says went wrong, as it says it: a code for programs, a message for people. */
export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'Problem';
  }

  get stale(): boolean {
    return this.status === 412;
  }
}

/** A response body with the ETag the resource came with, for `If-Match` later. */
export interface Stored<T> {
  readonly body: T;
  readonly etag?: string;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  readonly body?: unknown;
  readonly query?: Query;
  /** The ETag a write expects to replace. Sent as `If-Match`. */
  readonly etag?: string;
  readonly signal?: AbortSignal;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** The bearer token for a request, or nothing for an anonymous one. */
  readonly authorization: () => Promise<string | undefined>;
  /** Called on a 401, so the application can sign out and start over. */
  readonly onUnauthorized?: (problem: Problem) => void;
  readonly fetch?: typeof fetch;
}

/**
 * The API, one method per route.
 *
 * Content routes take the model as a string because the application does not
 * know the models until the API has told it: the same client serves a model
 * added to the ontology tomorrow.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    // The platform's fetch refuses to run with any other receiver, so it is
    // wrapped rather than stored and called as a method of this class.
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  // Meta

  models(): Promise<ModelInfo[]> {
    return this.body<{ models: ModelInfo[] }>('GET', '/v1/models').then(
      (r) => r.models,
    );
  }

  vocabularies(): Promise<Record<string, Vocabulary>> {
    return this.body<{ vocabularies: Record<string, Vocabulary> }>(
      'GET',
      '/v1/vocabularies',
    ).then((r) => r.vocabularies);
  }

  openapi(): Promise<unknown> {
    return this.body('GET', '/v1/openapi.json');
  }

  // Account and worlds

  me(): Promise<Me> {
    return this.body('GET', '/v1/me');
  }

  worlds(archived = false): Promise<World[]> {
    return this.body<{ worlds: World[] }>('GET', '/v1/worlds', {
      query: archived ? { archived: true } : {},
    }).then((r) => r.worlds);
  }

  createWorld(world: {
    name: string;
    visibility?: string;
    summary?: string;
  }): Promise<World> {
    return this.body('POST', '/v1/worlds', { body: world });
  }

  archiveWorld(world: string): Promise<void> {
    return this.body('DELETE', `/v1/worlds/${world}`);
  }

  restoreWorld(world: string): Promise<World> {
    return this.body('POST', `/v1/worlds/${world}/$restore`);
  }

  members(
    world: string,
  ): Promise<{ members: Member[]; invitations: unknown[] }> {
    return this.body('GET', `/v1/worlds/${world}/members`);
  }

  // Content

  list(world: string, model: string, query: Query = {}): Promise<Page> {
    return this.body('GET', `/v1/worlds/${world}/${model}`, { query });
  }

  get(
    world: string,
    model: string,
    id: string,
    query: Query = {},
  ): Promise<Stored<Resource>> {
    return this.request('GET', `/v1/worlds/${world}/${model}/${id}`, {
      query,
    });
  }

  create(
    world: string,
    model: string,
    body: unknown,
  ): Promise<Stored<Resource>> {
    return this.request('POST', `/v1/worlds/${world}/${model}`, { body });
  }

  put(
    world: string,
    model: string,
    id: string,
    body: unknown,
    etag?: string,
  ): Promise<Stored<Resource>> {
    return this.request('PUT', `/v1/worlds/${world}/${model}/${id}`, {
      body,
      etag,
    });
  }

  remove(world: string, model: string, id: string): Promise<void> {
    return this.body('DELETE', `/v1/worlds/${world}/${model}/${id}`);
  }

  references(
    world: string,
    model: string,
    id: string,
  ): Promise<ReferenceHit[]> {
    return this.body<{ references: ReferenceHit[] }>(
      'GET',
      `/v1/worlds/${world}/${model}/${id}/references`,
    ).then((r) => r.references);
  }

  history(world: string, model: string, id: string): Promise<HistoryEntry[]> {
    return this.body<{ history: HistoryEntry[] }>(
      'GET',
      `/v1/worlds/${world}/${model}/${id}/history`,
    ).then((r) => r.history);
  }

  search(
    world: string,
    q: string,
    limit = 20,
    models?: readonly string[],
  ): Promise<SearchHit[]> {
    return this.body<{ results: SearchHit[] }>(
      'GET',
      `/v1/worlds/${world}/$search`,
      {
        query: {
          q,
          limit,
          ...(models && models.length > 0 ? { models: models.join(',') } : {}),
        },
      },
    ).then((r) => r.results);
  }

  // Generation

  /** Generate resources from this world's content. Nothing is saved. */
  generate(world: string, model: string, input: unknown): Promise<Resource[]> {
    return this.body<{ resources: Resource[] }>(
      'POST',
      `/v1/worlds/${world}/${model}/$generate`,
      { body: input },
    ).then((r) => r.resources);
  }

  /** Save many resources in one transaction. Each carries its `model`. */
  importResources(
    world: string,
    resources: readonly Resource[],
  ): Promise<{ imported: number }> {
    return this.body('POST', `/v1/worlds/${world}/$import`, {
      body: { resources },
    });
  }

  // Plumbing

  private async body<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return (await this.request<T>(method, path, options)).body;
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Stored<T>> {
    const url = new URL(path, `${this.options.baseUrl}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await this.options.authorization();
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.etag) headers['if-match'] = options.etag;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause;
      }
      const reason = cause instanceof Error ? ` (${cause.message})` : '';
      throw new Problem(
        0,
        'network',
        `could not reach the API at ${this.options.baseUrl}${reason}`,
      );
    }

    if (!response.ok) throw await this.problemFrom(response);
    const etag = response.headers.get('etag') ?? undefined;
    if (response.status === 204) {
      return { body: undefined as T, ...(etag ? { etag } : {}) };
    }
    return { body: (await response.json()) as T, ...(etag ? { etag } : {}) };
  }

  private async problemFrom(response: Response): Promise<Problem> {
    let problem: Problem;
    try {
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        requestId?: string;
        issues?: unknown;
      };
      problem = new Problem(
        response.status,
        body.code ?? 'internal',
        body.error ?? response.statusText,
        body.requestId,
        body.issues,
      );
    } catch {
      problem = new Problem(
        response.status,
        response.status === 401 ? 'unauthorized' : 'internal',
        response.statusText || `the API answered ${response.status}`,
      );
    }
    if (problem.status === 401) this.options.onUnauthorized?.(problem);
    return problem;
  }
}
