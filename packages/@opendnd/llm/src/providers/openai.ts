import { Fetch, postJson, readLines, send, sseData } from '../http';
import { DEFAULT_MAX_TOKENS } from '../message';
import type {
  ModelRequest,
  ProviderResponse,
  StopReason,
  StreamChunk,
} from '../message';
import type { ModelSpec } from '../model';
import { ModelError, Provider } from '../provider';

export interface OpenAiCompatibleOptions {
  /** Provider id, so several endpoints can be registered side by side. */
  readonly id?: string;
  /** Base URL up to but not including `/chat/completions`. */
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

interface ChatReply {
  model?: string;
  choices?: {
    message?: { content?: string };
    delta?: { content?: string };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any endpoint that speaks the OpenAI chat completions shape, which is one
 * adapter for LM Studio, llama.cpp's server, vLLM and the hosted gateways:
 * an endpoint already running needs nothing but its base URL.
 */
export class OpenAiCompatibleProvider implements Provider {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: Fetch;
  private readonly extraHeaders: Record<string, string>;
  private readonly apiKey?: string;
  private readonly timeoutMs?: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.id = options.id ?? 'openai';
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.extraHeaders = options.headers ?? {};
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }

  async complete(
    spec: ModelSpec,
    request: ModelRequest,
  ): Promise<ProviderResponse> {
    const reply = await postJson<ChatReply>({
      provider: this.id,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: this.body(spec, request, false),
      fetch: this.fetchImpl,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
    });
    const choice = reply.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      usage: {
        inputTokens: reply.usage?.prompt_tokens ?? 0,
        outputTokens: reply.usage?.completion_tokens ?? 0,
      },
      stopReason: stopReason(choice?.finish_reason),
      modelId: reply.model ?? spec.modelId,
    };
  }

  async *stream(
    spec: ModelSpec,
    request: ModelRequest,
  ): AsyncIterable<StreamChunk> {
    const response = await send({
      provider: this.id,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: this.body(spec, request, true),
      fetch: this.fetchImpl,
    });
    if (!response.ok) {
      throw ModelError.fromStatus(this.id, response.status, '');
    }
    for await (const line of readLines(response.body)) {
      const data = sseData(line);
      if (data === undefined) continue;
      const chunk = JSON.parse(data) as ChatReply;
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { text };
      // Sent in the final frame, and only when include_usage was asked for.
      if (chunk.usage) {
        yield {
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          },
        };
      }
    }
  }

  async embed(spec: ModelSpec, texts: readonly string[]): Promise<number[][]> {
    const reply = await postJson<{ data?: { embedding?: number[] }[] }>({
      provider: this.id,
      url: `${this.baseUrl}/embeddings`,
      headers: this.headers(),
      body: { model: spec.modelId, input: texts },
      fetch: this.fetchImpl,
    });
    return (reply.data ?? []).map((d) => d.embedding ?? []);
  }

  private headers(): Record<string, string> {
    return {
      ...this.extraHeaders,
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private body(
    spec: ModelSpec,
    request: ModelRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const messages = [
      ...(request.system === undefined
        ? []
        : [{ role: 'system', content: request.system }]),
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    return {
      model: spec.modelId,
      messages,
      stream,
      // Without this a streamed call reports no tokens and cannot be billed.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      max_tokens:
        request.maxTokens ?? spec.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.topP === undefined ? {} : { top_p: request.topP }),
      ...(request.stop === undefined ? {} : { stop: [...request.stop] }),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      ...(request.schema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.schema.name,
                schema: request.schema.schema,
                strict: true,
              },
            },
          }
        : {}),
    };
  }
}

function stopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'stop':
    case null:
    case undefined:
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'filter';
    default:
      return 'other';
  }
}
