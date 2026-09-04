import { Fetch, postJson } from '../http';
import { DEFAULT_MAX_TOKENS } from '../message';
import type { ModelRequest, ProviderResponse, StopReason } from '../message';
import type { ModelSpec } from '../model';
import { ModelError, Provider } from '../provider';
import { Credentials, credentialsFromEnv, signRequest } from './sigv4';

/** Supplies credentials per call, so a rotating role keeps working. */
export type CredentialSource = () => Credentials | Promise<Credentials>;

export interface BedrockOptions {
  readonly region: string;
  /** Static credentials, or a source called before each request. */
  readonly credentials: Credentials | CredentialSource;
  /** Override the endpoint, for a VPC endpoint or a test double. */
  readonly baseUrl?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

interface ConverseReply {
  output?: {
    message?: {
      content?: { text?: string; toolUse?: { input?: unknown } }[];
    };
  };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Bedrock through the Converse API, which is one request shape for every
 * model family AWS hosts, so adding a model is a catalogue entry rather than
 * an adapter. Requests are signed with SigV4 from environment credentials,
 * which is what a Lambda already has.
 *
 * Streaming is not implemented: ConverseStream frames its events in AWS's
 * binary event-stream format, and `Models.stream` returns one chunk instead.
 */
export class BedrockProvider implements Provider {
  /** A provider from the ambient environment, or nothing if it holds no keys. */
  static fromEnv(
    env: Record<string, string | undefined>,
    fetchImpl?: Fetch,
  ): BedrockProvider | undefined {
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    const credentials = credentialsFromEnv(env);
    if (!region || !credentials) return undefined;
    return new BedrockProvider({
      region,
      credentials,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  readonly id = 'bedrock';
  private readonly region: string;
  private readonly baseUrl: string;
  private readonly source: CredentialSource;
  private readonly fetchImpl: Fetch;
  private readonly timeoutMs?: number;

  constructor(options: BedrockOptions) {
    this.region = options.region;
    this.baseUrl = (
      options.baseUrl ??
      `https://bedrock-runtime.${options.region}.amazonaws.com`
    ).replace(/\/$/, '');
    this.source =
      typeof options.credentials === 'function'
        ? options.credentials
        : () => options.credentials as Credentials;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as Fetch);
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }

  async complete(
    spec: ModelSpec,
    request: ModelRequest,
  ): Promise<ProviderResponse> {
    const reply = await this.call<ConverseReply>(
      spec.modelId,
      'converse',
      this.body(spec, request),
    );
    const blocks = reply.output?.message?.content ?? [];
    const tool = blocks.find((b) => b.toolUse?.input !== undefined);
    const text =
      tool !== undefined
        ? JSON.stringify(tool.toolUse!.input)
        : blocks.map((b) => b.text ?? '').join('');
    return {
      text,
      usage: {
        inputTokens: reply.usage?.inputTokens ?? 0,
        outputTokens: reply.usage?.outputTokens ?? 0,
      },
      stopReason: stopReason(reply.stopReason),
      modelId: spec.modelId,
    };
  }

  /**
   * Embeddings go through InvokeModel, whose body is model-specific. The two
   * families AWS hosts for this are handled; anything else needs a provider
   * with a uniform embedding API.
   */
  async embed(spec: ModelSpec, texts: readonly string[]): Promise<number[][]> {
    if (spec.modelId.includes('cohere')) {
      const reply = await this.call<{ embeddings?: number[][] }>(
        spec.modelId,
        'invoke',
        { texts: [...texts], input_type: 'search_document' },
      );
      return reply.embeddings ?? [];
    }
    if (!spec.modelId.includes('titan')) {
      throw new ModelError(
        `bedrock embeddings are implemented for the titan and cohere families, not ${spec.modelId}`,
        'unavailable',
        this.id,
      );
    }
    const out: number[][] = [];
    for (const inputText of texts) {
      const reply = await this.call<{ embedding?: number[] }>(
        spec.modelId,
        'invoke',
        { inputText },
      );
      out.push(reply.embedding ?? []);
    }
    return out;
  }

  private async call<T>(
    modelId: string,
    action: 'converse' | 'invoke',
    body: unknown,
  ): Promise<T> {
    // The model id is escaped in the path; the signer escapes it again, which
    // is what every AWS service but S3 expects.
    const url = `${this.baseUrl}/model/${encodeURIComponent(modelId)}/${action}`;
    const payload = JSON.stringify(body);
    const credentials = await this.source();
    const headers = signRequest({
      method: 'POST',
      url,
      region: this.region,
      service: 'bedrock',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: payload,
      credentials,
    });
    return postJson<T>({
      provider: this.id,
      url,
      headers,
      body,
      fetch: this.fetchImpl,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
    });
  }

  private body(
    spec: ModelSpec,
    request: ModelRequest,
  ): Record<string, unknown> {
    const inference: Record<string, unknown> = {
      maxTokens:
        request.maxTokens ?? spec.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (request.temperature !== undefined) {
      inference.temperature = request.temperature;
    }
    if (request.topP !== undefined) inference.topP = request.topP;
    if (request.stop !== undefined) inference.stopSequences = [...request.stop];
    return {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: [{ text: m.content }],
      })),
      ...(request.system === undefined
        ? {}
        : { system: [{ text: request.system }] }),
      inferenceConfig: inference,
      // A schema is enforced the same way as on Anthropic: one required tool.
      ...(request.schema
        ? {
            toolConfig: {
              tools: [
                {
                  toolSpec: {
                    name: request.schema.name,
                    description: `Return the result as ${request.schema.name}.`,
                    inputSchema: { json: request.schema.schema },
                  },
                },
              ],
              toolChoice: { tool: { name: request.schema.name } },
            },
          }
        : {}),
    };
  }
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
    case 'content_filtered':
    case 'guardrail_intervened':
      return 'filter';
    default:
      return 'other';
  }
}
