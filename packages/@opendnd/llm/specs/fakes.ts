import type {
  Fetch,
  ModelRequest,
  ModelSpec,
  Provider,
  ProviderResponse,
  StreamChunk,
} from 'src';
import { ModelError } from 'src';

/** A scripted provider: each call takes the next reply or error in the list. */
export class FakeProvider implements Provider {
  readonly calls: { spec: ModelSpec; request: ModelRequest }[] = [];

  constructor(
    readonly id: string,
    private readonly script: (
      string | ModelError | Partial<ProviderResponse>
    )[],
  ) {}

  async complete(
    spec: ModelSpec,
    request: ModelRequest,
  ): Promise<ProviderResponse> {
    this.calls.push({ spec, request });
    const next = this.script.shift();
    if (next === undefined) {
      throw new ModelError(`${this.id} ran out of script`, 'fatal', this.id);
    }
    if (next instanceof ModelError) throw next;
    const partial = typeof next === 'string' ? { text: next } : next;
    return {
      text: '',
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'stop',
      modelId: spec.modelId,
      ...partial,
    };
  }

  async *stream(
    spec: ModelSpec,
    request: ModelRequest,
  ): AsyncIterable<StreamChunk> {
    const reply = await this.complete(spec, request);
    for (const word of reply.text.split(' ')) yield { text: `${word} ` };
    yield { usage: reply.usage };
  }

  async embed(_spec: ModelSpec, texts: readonly string[]): Promise<number[][]> {
    return texts.map((t) => [t.length, 1, 2]);
  }
}

export const localModel: ModelSpec = {
  id: 'test-local',
  provider: 'local',
  modelId: 'llama-test',
  contextWindow: 8192,
  maxOutputTokens: 1024,
  capabilities: ['schema'],
};

export const hostedModel: ModelSpec = {
  id: 'test-hosted',
  provider: 'hosted',
  modelId: 'hosted-test',
  contextWindow: 200000,
  maxOutputTokens: 4096,
  capabilities: ['schema', 'tools'],
  pricing: { inputPerMillion: 3, outputPerMillion: 15 },
};

export const embedModel: ModelSpec = {
  id: 'test-embed',
  provider: 'hosted',
  modelId: 'embed-test',
  contextWindow: 8192,
  capabilities: ['embedding'],
  pricing: { inputPerMillion: 0.02, outputPerMillion: 0 },
};

/** A fetch that records what it was asked and replies from a queue. */
export function stubFetch(
  replies: { status?: number; body: unknown; stream?: string[] }[],
): {
  fetch: Fetch;
  requests: { url: string; headers: Record<string, string>; body: unknown }[];
} {
  const requests: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  const queue = [...replies];
  const fetch: Fetch = async (url, init) => {
    requests.push({
      url,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const next = queue.shift() ?? { body: {} };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      ...(next.stream
        ? { body: linesToStream(next.stream) }
        : { body: undefined }),
      text: async () => JSON.stringify(next.body),
    };
  };
  return { fetch, requests };
}

/** A body that yields the given lines, the way a streaming response does. */
function linesToStream(lines: readonly string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield encoder.encode(`${line}\n`);
    },
  };
}
