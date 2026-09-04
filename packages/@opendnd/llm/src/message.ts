/** Who said a thing in a conversation. */
export type Role = 'user' | 'assistant';

export interface Message {
  readonly role: Role;
  readonly content: string;
}

/** A JSON Schema object, as produced by `z.toJSONSchema`. */
export type JsonSchema = Record<string, unknown>;

/**
 * One request to a language model, in provider-neutral terms. Providers
 * translate this into their own wire format and translate the reply back;
 * nothing above this layer knows which provider answered.
 */
export interface ModelRequest {
  /** Standing instruction, sent separately from the turns where a provider supports it. */
  readonly system?: string;
  readonly messages: readonly Message[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stop?: readonly string[];
  /**
   * A schema the reply must satisfy. Providers enforce it natively where they
   * can (Ollama's `format`, OpenAI's `json_schema`, a single-tool call on
   * Anthropic and Bedrock); `structured()` validates it either way.
   */
  readonly schema?: {
    readonly name: string;
    readonly schema: JsonSchema;
  };
  /**
   * Sampling seed, where the provider takes one. Local models honour it and
   * become reproducible; hosted ones generally ignore it.
   */
  readonly seed?: number;
  /**
   * Whether the model may reason before answering.
   *
   * A reasoning model given a small output budget can spend all of it
   * thinking and return no answer at all, so a prose task with a tight cap
   * should turn it off. Implemented for Ollama; hosted providers ignore it
   * for now.
   */
  readonly think?: boolean;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type StopReason = 'stop' | 'length' | 'filter' | 'other';

/** What a provider hands back, before the task and the cost are added. */
export interface ProviderResponse {
  readonly text: string;
  readonly usage: Usage;
  readonly stopReason: StopReason;
  /** The provider's own model identifier, as it reported it. */
  readonly modelId: string;
  /**
   * Reasoning the model reported separately from its answer. Recorded so a
   * reply that is all reasoning and no answer can be told from one that is
   * simply empty. It is not the answer and is never stored as one.
   */
  readonly reasoning?: string;
}

/**
 * One piece of a streamed reply: text as it arrives, and the token counts at
 * the end, where the provider reports them. Usage travels with the text so a
 * streamed call can be priced like any other.
 */
export interface StreamChunk {
  readonly text?: string;
  readonly usage?: Usage;
  readonly stopReason?: StopReason;
}

/** A completed call, with everything needed to bill it and cite it. */
export interface ModelResponse extends ProviderResponse {
  /** The task this call ran, e.g. `chronicle`. */
  readonly task: string;
  /** The model that answered, by its configured name, e.g. `claude-sonnet`. */
  readonly model: string;
  readonly provider: string;
  /** What the tokens cost, in millionths of a dollar. Zero for local models. */
  readonly costMicros: number;
  /** True when the reply came from the cache and cost nothing. */
  readonly cached: boolean;
  /** Hash of the request, for provenance and for the cache key. */
  readonly promptHash: string;
}

/** Output budget used when neither the call, the task nor the model says. */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * A rough token count: four characters to the token. Accurate enough only to
 * refuse a prompt that cannot fit a model's context window, which is all it
 * is used for.
 */
export function estimateTokens(request: ModelRequest): number {
  let chars = (request.system ?? '').length;
  for (const m of request.messages) chars += m.content.length + 8;
  if (request.schema) chars += JSON.stringify(request.schema.schema).length;
  return Math.ceil(chars / 4);
}
