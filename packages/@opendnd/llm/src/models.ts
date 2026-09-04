import { CacheStore, promptHash } from './cache';
import { Budget, DEFAULT_MARGIN, Ledger, recordFor } from './ledger';
import type {
  Message,
  ModelRequest,
  ModelResponse,
  ProviderResponse,
  Usage,
} from './message';
import { DEFAULT_MAX_TOKENS, estimateTokens } from './message';
import { ModelSpec, costOf } from './model';
import { ModelError, Provider } from './provider';

/**
 * Defaults for one kind of work: the voice it is written in, how hot, how
 * long, and which model does it. Every field is the user's to set; a task
 * exists so that "which model writes chronicles" is answered once, in
 * configuration, rather than at every call site.
 */
export interface TaskConfig {
  /** Model id. Omitted means the deployment's default model is used. */
  readonly model?: string;
  /** Standing instruction, used when the call supplies none. */
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Whether the model may reason before answering. See `ModelRequest.think`. */
  readonly think?: boolean;
}

/** A task is its config, or just a model id when nothing else differs. */
export type Task = TaskConfig | string;

/** A task in its long form, whichever form it was written in. */
export function asTaskConfig(task: Task | undefined): TaskConfig {
  if (task === undefined) return {};
  return typeof task === 'string' ? { model: task } : task;
}

export interface ModelsOptions {
  readonly providers: readonly Provider[];
  /** What is known about each model: its provider, limits and price. */
  readonly models: readonly ModelSpec[];
  readonly tasks?: Readonly<Record<string, Task>>;
  /** Used by any task that names no model of its own. */
  readonly defaultModel?: string;
  readonly cache?: CacheStore;
  readonly ledger?: Ledger;
  readonly budget?: Budget;
  /** Margin added to cost when charging. */
  readonly margin?: number;
  /** Tries before giving up on a rate limit or a 5xx. Default 2. */
  readonly attempts?: number;
  /** First backoff, doubled per retry. Default 250 ms; tests pass 0. */
  readonly retryDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Recorded on every usage line. */
  readonly world?: string;
  readonly requestedBy?: string;
}

/** No model was named, or the named model belongs to no registered provider. */
export class NoModelError extends Error {
  constructor(
    message: string,
    readonly known: readonly string[],
  ) {
    super(
      known.length > 0
        ? `${message}. Models known here: ${known.join(', ')}` +
            ' (available() lists what the endpoints actually hold)'
        : message,
    );
    this.name = 'NoModelError';
  }
}

/**
 * One way in to every model.
 *
 * A call may name the model to use; otherwise the task's configured model is
 * used, and failing that the deployment's default. A model that fails is
 * reported rather than replaced, so the choice of what to do next stays with
 * the caller, and `available()` lists what the configured endpoints can serve
 * so a person can be offered that choice.
 *
 * The rest is the plumbing every model call needs: dispatch to the right
 * provider, retry a transient failure, price the tokens, write the usage
 * line, and keep the cache.
 */
export class Models {
  private readonly providers = new Map<string, Provider>();
  private readonly specs = new Map<string, ModelSpec>();
  private readonly tasks: Readonly<Record<string, Task>>;
  private readonly defaultModel?: string;
  private readonly cache?: CacheStore;
  private readonly ledger?: Ledger;
  private readonly budget?: Budget;
  private readonly margin: number;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly world?: string;
  private readonly requestedBy?: string;

  constructor(options: ModelsOptions) {
    for (const provider of options.providers) {
      this.providers.set(provider.id, provider);
    }
    for (const spec of options.models) this.specs.set(spec.id, spec);
    this.tasks = options.tasks ?? {};
    if (options.defaultModel !== undefined) {
      this.defaultModel = options.defaultModel;
    }
    if (options.cache !== undefined) this.cache = options.cache;
    if (options.ledger !== undefined) this.ledger = options.ledger;
    if (options.budget !== undefined) this.budget = options.budget;
    this.margin = options.margin ?? DEFAULT_MARGIN;
    this.attempts = Math.max(1, options.attempts ?? 2);
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    if (options.world !== undefined) this.world = options.world;
    if (options.requestedBy !== undefined) {
      this.requestedBy = options.requestedBy;
    }
  }

  /** A task's configuration, in its long form. */
  taskFor(name: string): TaskConfig {
    return asTaskConfig(this.tasks[name]);
  }

  /**
   * The model a call will use. An id absent from the catalogue is taken at
   * face value as a tag on the local Ollama, so a model that has just been
   * pulled can be named straight away.
   */
  resolve(name: string, chosen?: string): ModelSpec {
    const id = chosen ?? this.taskFor(name).model ?? this.defaultModel;
    if (id === undefined) {
      throw new NoModelError(
        `no model was named for ${name}, and no default model is set`,
        [...this.specs.keys()],
      );
    }
    const known = this.specs.get(id);
    if (known) {
      if (!this.providers.has(known.provider)) {
        throw new NoModelError(
          `${id} runs on ${known.provider}, which is not configured here`,
          [...this.specs.keys()].filter((k) =>
            this.providers.has(this.specs.get(k)!.provider),
          ),
        );
      }
      return known;
    }
    const local = this.providers.get('ollama');
    if (!local) {
      throw new NoModelError(`${id} is not a model this deployment knows`, [
        ...this.specs.keys(),
      ]);
    }
    return assumedLocal(id);
  }

  /** Every model the configured providers are known to serve, for a picker. */
  catalogue(): ModelSpec[] {
    return [...this.specs.values()].filter((s) =>
      this.providers.has(s.provider),
    );
  }

  /**
   * What can actually be called right now. Endpoints that can be asked are
   * asked, so a local Ollama contributes the models it has pulled — including
   * ones absent from the catalogue — and an endpoint that is down contributes
   * nothing. This is what a model picker should show.
   */
  async available(): Promise<ModelSpec[]> {
    const out: ModelSpec[] = [];
    for (const provider of this.providers.values()) {
      const known = [...this.specs.values()].filter(
        (s) => s.provider === provider.id,
      );
      if (!provider.list) {
        out.push(...known);
        continue;
      }
      let tags: string[];
      try {
        tags = await provider.list();
      } catch {
        continue;
      }
      const byModelId = new Map(known.map((s) => [s.modelId, s]));
      for (const tag of tags) {
        out.push(byModelId.get(tag) ?? assumedLocal(tag, provider.id));
      }
    }
    return out;
  }

  /**
   * Run a task on a model. `options.model` overrides the task's configured
   * model.
   */
  async complete(
    name: string,
    request: ModelRequest,
    options: { readonly model?: string; readonly noCache?: boolean } = {},
  ): Promise<ModelResponse> {
    const spec = this.resolve(name, options.model);
    const full = merge(this.taskFor(name), request);
    this.checkFits(spec, full);
    const provider = this.providers.get(spec.provider)!;
    const key = promptHash(spec.id, full);
    const useCache = this.cache !== undefined && options.noCache !== true;

    if (useCache) {
      const hit = await this.cache!.get(key);
      if (hit) {
        const cached: ModelResponse = { ...hit, cached: true, costMicros: 0 };
        await this.report(cached);
        return cached;
      }
    }

    let last: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      this.budget?.check();
      try {
        const reply = await provider.complete(spec, full);
        const response = this.finish(name, spec, full, reply);
        if (useCache) await this.cache!.set(key, response);
        await this.report(response);
        return response;
      } catch (error) {
        last = error;
        // Only a transient failure is worth another attempt on the same
        // model; anything else is reported to the caller.
        const kind = error instanceof ModelError ? error.kind : 'retryable';
        if (kind !== 'retryable') throw error;
        if (attempt + 1 < this.attempts) {
          await this.sleep(this.retryDelayMs * 2 ** attempt);
        }
      }
    }
    throw last;
  }

  /**
   * Text as it arrives. A provider that cannot stream still answers, in one
   * piece, so a caller can render progressively without knowing who is on the
   * other end.
   */
  async *stream(
    name: string,
    request: ModelRequest,
    options: { readonly model?: string } = {},
  ): AsyncIterable<string> {
    const spec = this.resolve(name, options.model);
    const full = merge(this.taskFor(name), request);
    this.checkFits(spec, full);
    const provider = this.providers.get(spec.provider)!;
    if (!provider.stream) {
      const response = await this.complete(name, request, options);
      yield response.text;
      return;
    }

    this.budget?.check();
    let text = '';
    let usage: Usage | undefined;
    try {
      for await (const chunk of provider.stream(spec, full)) {
        if (chunk.usage) usage = chunk.usage;
        if (chunk.text !== undefined && chunk.text !== '') {
          text += chunk.text;
          yield chunk.text;
        }
      }
    } finally {
      // What was consumed is billed, whether or not the stream finished.
      if (text !== '') await this.reportStream(name, spec, full, text, usage);
    }
  }

  /** Vectors for search. */
  async embed(
    name: string,
    texts: readonly string[],
    options: { readonly model?: string } = {},
  ): Promise<number[][]> {
    const spec = this.resolve(name, options.model);
    const provider = this.providers.get(spec.provider)!;
    if (!provider.embed) {
      throw new NoModelError(
        `${spec.provider} cannot produce embeddings`,
        this.catalogue()
          .filter((s) => s.capabilities.includes('embedding'))
          .map((s) => s.id),
      );
    }
    this.budget?.check();
    const vectors = await provider.embed(spec, texts);
    // Embedding endpoints do not all report token counts, so cost is
    // estimated from the length of the text.
    const usage = {
      inputTokens: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
      outputTokens: 0,
    };
    await this.report(
      {
        task: name,
        model: spec.id,
        provider: spec.provider,
        modelId: spec.modelId,
        text: '',
        usage,
        stopReason: 'stop',
        costMicros: costOf(spec, usage),
        cached: false,
        promptHash: promptHash(spec.id, { messages: texts.map(asMessage) }),
      },
      true,
    );
    return vectors;
  }

  /**
   * Refuse a prompt that cannot fit, naming both numbers so that a larger
   * model can be chosen. A model whose context window is unknown is not
   * checked.
   */
  private checkFits(spec: ModelSpec, request: ModelRequest): void {
    if (spec.contextWindow === undefined) return;
    const needed =
      estimateTokens(request) + (request.maxTokens ?? DEFAULT_MAX_TOKENS);
    if (needed > spec.contextWindow) {
      throw new ModelError(
        `this prompt needs about ${needed} tokens and ${spec.id} holds ${spec.contextWindow}`,
        'fatal',
        spec.provider,
      );
    }
  }

  private finish(
    task: string,
    spec: ModelSpec,
    request: ModelRequest,
    reply: ProviderResponse,
  ): ModelResponse {
    if (reply.text.trim() === '') {
      // The commonest cause is a reasoning model that spent its whole output
      // budget thinking. Say so, because the fix is the caller's to make.
      throw new ModelError(
        `${spec.id} returned nothing` +
          (reply.reasoning
            ? ' but its reasoning; raise maxTokens or set think: false'
            : ` (stopped: ${reply.stopReason})`),
        'unavailable',
        spec.provider,
      );
    }
    return {
      ...reply,
      task,
      model: spec.id,
      provider: spec.provider,
      costMicros: costOf(spec, reply.usage),
      cached: false,
      promptHash: promptHash(spec.id, request),
    };
  }

  /**
   * Bill a streamed call. Where the provider reported no token counts they are
   * estimated from the text and the line says so, so that a streamed call is
   * never left off the bill.
   */
  private async reportStream(
    task: string,
    spec: ModelSpec,
    request: ModelRequest,
    text: string,
    reported: Usage | undefined,
  ): Promise<void> {
    const usage: Usage = reported ?? {
      inputTokens: estimateTokens(request),
      outputTokens: Math.ceil(text.length / 4),
    };
    await this.report(
      {
        task,
        model: spec.id,
        provider: spec.provider,
        modelId: spec.modelId,
        text,
        usage,
        stopReason: 'stop',
        costMicros: costOf(spec, usage),
        cached: false,
        promptHash: promptHash(spec.id, request),
      },
      reported === undefined,
    );
  }

  private async report(
    response: ModelResponse,
    estimated = false,
  ): Promise<void> {
    this.budget?.spend(response.costMicros);
    if (!this.ledger) return;
    await this.ledger.record(
      recordFor(response, this.margin, {
        estimated,
        ...(this.world ? { world: this.world } : {}),
        ...(this.requestedBy ? { requestedBy: this.requestedBy } : {}),
      }),
    );
  }
}

/**
 * A model id absent from the catalogue, taken as a tag on a local endpoint.
 * Its context window and price are left unset because they are not known, so
 * it is neither checked against a limit nor billed.
 */
export function assumedLocal(tag: string, provider = 'ollama'): ModelSpec {
  return { id: tag, provider, modelId: tag, capabilities: ['schema'] };
}

/** A request with the task's defaults filled in where the call left gaps. */
function merge(task: TaskConfig, request: ModelRequest): ModelRequest {
  return {
    ...request,
    ...(request.system === undefined && task.system !== undefined
      ? { system: task.system }
      : {}),
    ...(request.temperature === undefined && task.temperature !== undefined
      ? { temperature: task.temperature }
      : {}),
    ...(request.maxTokens === undefined && task.maxTokens !== undefined
      ? { maxTokens: task.maxTokens }
      : {}),
    ...(request.think === undefined && task.think !== undefined
      ? { think: task.think }
      : {}),
  };
}

function asMessage(content: string): Message {
  return { role: 'user', content };
}
