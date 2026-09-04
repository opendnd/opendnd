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

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly version?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

interface MessagesReply {
  model?: string;
  content?: { type?: string; text?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** The Anthropic API direct, for anyone holding their own key. */
export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly fetchImpl: Fetch;
  private readonly timeoutMs?: number;

  constructor(options: AnthropicOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(
      /\/$/,
      '',
    );
    this.version = options.version ?? '2023-06-01';
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as Fetch);
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }

  async complete(
    spec: ModelSpec,
    request: ModelRequest,
  ): Promise<ProviderResponse> {
    const reply = await postJson<MessagesReply>({
      provider: this.id,
      url: `${this.baseUrl}/v1/messages`,
      headers: this.headers(),
      body: this.body(spec, request, false),
      fetch: this.fetchImpl,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
    });
    return {
      text: textOf(reply),
      usage: {
        inputTokens: reply.usage?.input_tokens ?? 0,
        outputTokens: reply.usage?.output_tokens ?? 0,
      },
      stopReason: stopReason(reply.stop_reason),
      modelId: reply.model ?? spec.modelId,
    };
  }

  async *stream(
    spec: ModelSpec,
    request: ModelRequest,
  ): AsyncIterable<StreamChunk> {
    const response = await send({
      provider: this.id,
      url: `${this.baseUrl}/v1/messages`,
      headers: this.headers(),
      body: this.body(spec, request, true),
      fetch: this.fetchImpl,
    });
    if (!response.ok) {
      throw ModelError.fromStatus(this.id, response.status, '');
    }
    let input = 0;
    for await (const line of readLines(response.body)) {
      const data = sseData(line);
      if (data === undefined) continue;
      const event = JSON.parse(data) as {
        type?: string;
        delta?: { type?: string; text?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (event.type === 'content_block_delta' && event.delta?.text) {
        yield { text: event.delta.text };
      }
      // Input tokens arrive first, output tokens last; both are needed to bill.
      if (event.type === 'message_start' && event.message?.usage) {
        input = event.message.usage.input_tokens ?? 0;
      }
      if (event.type === 'message_delta' && event.usage) {
        yield {
          usage: {
            inputTokens: input,
            outputTokens: event.usage.output_tokens ?? 0,
          },
        };
      }
    }
  }

  private headers(): Record<string, string> {
    return { 'x-api-key': this.apiKey, 'anthropic-version': this.version };
  }

  private body(
    spec: ModelSpec,
    request: ModelRequest,
    stream: boolean,
  ): Record<string, unknown> {
    return {
      model: spec.modelId,
      max_tokens:
        request.maxTokens ?? spec.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream,
      ...(request.system === undefined ? {} : { system: request.system }),
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.topP === undefined ? {} : { top_p: request.topP }),
      ...(request.stop === undefined
        ? {}
        : { stop_sequences: [...request.stop] }),
      // A schema is enforced by offering exactly one tool and requiring it.
      ...(request.schema
        ? {
            tools: [
              {
                name: request.schema.name,
                description: `Return the result as ${request.schema.name}.`,
                input_schema: request.schema.schema,
              },
            ],
            tool_choice: { type: 'tool', name: request.schema.name },
          }
        : {}),
    };
  }
}

/**
 * The reply's text. A required tool call arrives as structured input rather
 * than text, so it is serialised back to JSON and the layer above parses it
 * the same way it parses every other provider's structured reply.
 */
function textOf(reply: MessagesReply): string {
  const blocks = reply.content ?? [];
  const tool = blocks.find((b) => b.type === 'tool_use');
  if (tool?.input !== undefined) return JSON.stringify(tool.input);
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

function stopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
    case undefined:
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'filter';
    default:
      return 'other';
  }
}
