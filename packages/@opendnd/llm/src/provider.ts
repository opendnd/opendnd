import type { ModelRequest, ProviderResponse, StreamChunk } from './message';
import type { ModelSpec } from './model';

/**
 * What kind of failure this is, which decides whether trying again could
 * help. `retryable` is transient and worth another attempt on the same model:
 * a rate limit, a timeout, a 5xx. `unavailable` means the model cannot serve
 * the request at all — not pulled on the local Ollama, not enabled in the
 * region, no credentials, nothing in the reply — so only a different model
 * would help. `fatal` is a malformed request, which no model will answer.
 */
export type FailureKind = 'retryable' | 'unavailable' | 'fatal';

export class ModelError extends Error {
  /** Classify an HTTP status the way these providers use them. */
  static fromStatus(
    provider: string,
    status: number,
    body: string,
  ): ModelError {
    const kind: FailureKind =
      status === 404 || status === 403 || status === 401
        ? 'unavailable'
        : status === 408 || status === 409 || status === 429 || status >= 500
          ? 'retryable'
          : 'fatal';
    return new ModelError(
      `${provider} returned ${status}: ${body.slice(0, 400)}`,
      kind,
      provider,
      status,
    );
  }

  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly provider: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/**
 * An endpoint that serves models. Implementations hold the wire format and
 * nothing else: no model choice, no retries, no cost, no cache.
 */
export interface Provider {
  readonly id: string;
  complete(spec: ModelSpec, request: ModelRequest): Promise<ProviderResponse>;
  /** Text as it arrives, with the token counts at the end where they are
   * reported. Absent where the provider's stream format is not supported. */
  stream?(spec: ModelSpec, request: ModelRequest): AsyncIterable<StreamChunk>;
  embed?(spec: ModelSpec, texts: readonly string[]): Promise<number[][]>;
  /** The models the endpoint actually holds, where it can be asked. */
  list?(): Promise<string[]>;
}
