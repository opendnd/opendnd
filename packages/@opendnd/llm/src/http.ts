import { ModelError } from './provider';

/** The slice of `fetch` providers use, so tests can supply their own. */
export type Fetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  body?: unknown;
  text(): Promise<string>;
}>;

export interface PostOptions {
  readonly provider: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
  readonly fetch: Fetch;
  readonly timeoutMs?: number;
}

/** POST JSON, parse JSON, and turn every failure into a ModelError. */
export async function postJson<T>(options: PostOptions): Promise<T> {
  const text = await postText(options);
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ModelError(
      `${options.provider} returned a body that is not JSON`,
      'retryable',
      options.provider,
      undefined,
      cause,
    );
  }
}

/** POST JSON and return the raw body, for streams and for error paths. */
export async function postText(options: PostOptions): Promise<string> {
  const response = await send(options);
  const text = await response.text();
  if (!response.ok) {
    throw ModelError.fromStatus(options.provider, response.status, text);
  }
  return text;
}

/** POST JSON and hand back the response for a caller that wants the stream. */
export async function send(
  options: PostOptions,
): Promise<Awaited<ReturnType<Fetch>>> {
  const { provider, url, body, headers = {}, timeoutMs } = options;
  const controller =
    timeoutMs === undefined ? undefined : new AbortController();
  const timer =
    controller && timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    return await options.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (cause) {
    // A refused connection is the local case: Ollama is not running. Trying
    // again will not help, so it is reported rather than retried.
    throw new ModelError(
      `${provider} could not be reached at ${url}`,
      'unavailable',
      provider,
      undefined,
      cause,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Split a response body into lines as they arrive. Covers both streaming
 * formats in use here: newline-delimited JSON (Ollama) and server-sent events
 * (OpenAI-compatible, Anthropic), whose payload lines are `data: ...`.
 */
export async function* readLines(body: unknown): AsyncIterable<string> {
  const stream = body as
    | AsyncIterable<Uint8Array>
    | { getReader(): ReadableStreamDefaultReader<Uint8Array> }
    | null
    | undefined;
  if (!stream) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunks(stream)) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) yield line;
      index = buffer.indexOf('\n');
    }
  }
  const rest = buffer.trim();
  if (rest.length > 0) yield rest;
}

/** Iterate a body whether it is async-iterable or a web ReadableStream. */
async function* chunks(
  stream:
    | AsyncIterable<Uint8Array>
    | { getReader(): ReadableStreamDefaultReader<Uint8Array> },
): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in stream) {
    yield* stream as AsyncIterable<Uint8Array>;
    return;
  }
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}

/** The payload of a server-sent event line, or undefined for a comment. */
export function sseData(line: string): string | undefined {
  if (!line.startsWith('data:')) return undefined;
  const data = line.slice(5).trim();
  return data === '[DONE]' ? undefined : data;
}
