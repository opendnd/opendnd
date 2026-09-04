import { Fetch, postJson, readLines, send } from '../http';
import type {
  Message,
  ModelRequest,
  ProviderResponse,
  StopReason,
  StreamChunk,
} from '../message';
import type { ModelSpec } from '../model';
import { ModelError, Provider } from '../provider';

export interface OllamaOptions {
  /** Where Ollama listens. */
  readonly baseUrl?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

interface ChatReply {
  model?: string;
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Ollama on the user's own machine. This is the local-first path: no key, no
 * network, no cost, and a sampling seed that makes replies reproducible.
 * Structured output uses Ollama's `format`, which takes a JSON Schema.
 */
export class OllamaProvider implements Provider {
  readonly id = 'ollama';
  private readonly baseUrl: string;
  private readonly fetchImpl: Fetch;
  private readonly timeoutMs?: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as Fetch);
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }

  async complete(
    spec: ModelSpec,
    request: ModelRequest,
  ): Promise<ProviderResponse> {
    const reply = await postJson<ChatReply>({
      provider: this.id,
      url: `${this.baseUrl}/api/chat`,
      body: this.body(spec, request, false),
      fetch: this.fetchImpl,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
    });
    if (reply.error !== undefined) {
      // A model that is not pulled is reported in the body, not the status.
      throw new ModelError(reply.error, 'unavailable', this.id);
    }
    const thinking = reply.message?.thinking;
    return {
      text: reply.message?.content ?? '',
      usage: {
        inputTokens: reply.prompt_eval_count ?? 0,
        outputTokens: reply.eval_count ?? 0,
      },
      stopReason: stopReason(reply.done_reason),
      modelId: reply.model ?? spec.modelId,
      ...(thinking ? { reasoning: thinking } : {}),
    };
  }

  async *stream(
    spec: ModelSpec,
    request: ModelRequest,
  ): AsyncIterable<StreamChunk> {
    const response = await send({
      provider: this.id,
      url: `${this.baseUrl}/api/chat`,
      body: this.body(spec, request, true),
      fetch: this.fetchImpl,
    });
    if (!response.ok) {
      throw ModelError.fromStatus(this.id, response.status, '');
    }
    for await (const line of readLines(response.body)) {
      const chunk = JSON.parse(line) as ChatReply;
      const text = chunk.message?.content;
      if (text) yield { text };
      // The last chunk carries the counts, which is what makes it billable.
      if (chunk.done === true) {
        yield {
          usage: {
            inputTokens: chunk.prompt_eval_count ?? 0,
            outputTokens: chunk.eval_count ?? 0,
          },
          stopReason: stopReason(chunk.done_reason),
        };
      }
    }
  }

  async embed(spec: ModelSpec, texts: readonly string[]): Promise<number[][]> {
    const reply = await postJson<{ embeddings?: number[][] }>({
      provider: this.id,
      url: `${this.baseUrl}/api/embed`,
      body: { model: spec.modelId, input: texts },
      fetch: this.fetchImpl,
    });
    return reply.embeddings ?? [];
  }

  /** The models this Ollama holds, for `Models.available()`. */
  async list(): Promise<string[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
      method: 'GET',
      headers: {},
    });
    if (!response.ok) return [];
    const body = JSON.parse(await response.text()) as {
      models?: { name?: string }[];
    };
    return (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => n !== undefined);
  }

  private body(
    spec: ModelSpec,
    request: ModelRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.topP !== undefined) options.top_p = request.topP;
    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }
    if (request.seed !== undefined) options.seed = request.seed;
    if (request.stop !== undefined) options.stop = [...request.stop];
    return {
      model: spec.modelId,
      messages: messages(request),
      stream,
      ...(request.think === undefined ? {} : { think: request.think }),
      ...(request.schema ? { format: request.schema.schema } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  }
}

/** Ollama takes the system instruction as the first turn. */
function messages(request: ModelRequest): { role: string; content: string }[] {
  const turns = request.messages.map((m: Message) => ({
    role: m.role as string,
    content: m.content,
  }));
  return request.system === undefined
    ? turns
    : [{ role: 'system', content: request.system }, ...turns];
}

function stopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case undefined:
      return 'stop';
    default:
      return 'other';
  }
}
