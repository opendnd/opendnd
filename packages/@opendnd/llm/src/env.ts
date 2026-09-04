import { FileCache } from './cache';
import { DEFAULT_TASKS, KNOWN_MODELS } from './catalog';
import type { Fetch } from './http';
import { Budget, Ledger } from './ledger';
import type { ModelSpec } from './model';
import { Models, Task, asTaskConfig } from './models';
import type { Provider } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { BedrockProvider } from './providers/bedrock';
import { OllamaProvider } from './providers/ollama';
import { OpenAiCompatibleProvider } from './providers/openai';

export interface EnvOptions {
  readonly env?: Record<string, string | undefined>;
  readonly fetch?: Fetch;
  readonly ledger?: Ledger;
  readonly world?: string;
  readonly requestedBy?: string;
}

/**
 * A `Models` from the environment, which is how every deployment gets one.
 * With nothing set at all it talks to an Ollama on the usual port, and the
 * model to use is named per call until `OPENDND_LLM_MODEL` says otherwise.
 *
 * | Variable | Effect |
 * |---|---|
 * | `OPENDND_LLM_MODEL` | Default model for tasks that name none. |
 * | `OLLAMA_URL` | Where Ollama listens. Default `http://localhost:11434`. |
 * | `OPENDND_LLM_LOCAL=off` | Do not register Ollama at all. |
 * | `AWS_REGION` plus credentials | Register Bedrock. |
 * | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | Register the Anthropic API. |
 * | `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Register any OpenAI-compatible endpoint. |
 * | `OPENDND_LLM_MODELS` | JSON array of model specs, merged over the catalogue by id. |
 * | `OPENDND_LLM_TASKS` | JSON object of task to config, merged over the defaults. |
 * | `OPENDND_LLM_BUDGET` | Spending ceiling for this process, in dollars. |
 * | `OPENDND_LLM_CACHE` | Directory to cache replies in. |
 * | `OPENDND_LLM_MARGIN` | Margin over cost when charging. Default 0.1. |
 */
export function modelsFromEnv(options: EnvOptions = {}): Models {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch;
  const providers: Provider[] = [];

  if (env.OPENDND_LLM_LOCAL !== 'off') {
    providers.push(
      new OllamaProvider({
        ...(env.OLLAMA_URL ? { baseUrl: env.OLLAMA_URL } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }
  const bedrock = BedrockProvider.fromEnv(env, fetchImpl);
  if (bedrock) providers.push(bedrock);
  if (env.ANTHROPIC_API_KEY) {
    providers.push(
      new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(env.ANTHROPIC_BASE_URL ? { baseUrl: env.ANTHROPIC_BASE_URL } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }
  if (env.OPENAI_BASE_URL) {
    providers.push(
      new OpenAiCompatibleProvider({
        baseUrl: env.OPENAI_BASE_URL,
        ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }

  const budgetDollars = Number(env.OPENDND_LLM_BUDGET ?? '');
  const margin = Number(env.OPENDND_LLM_MARGIN ?? '');

  return new Models({
    providers,
    models: mergeModels(KNOWN_MODELS, env.OPENDND_LLM_MODELS),
    tasks: mergeTasks(DEFAULT_TASKS, env.OPENDND_LLM_TASKS),
    ...(env.OPENDND_LLM_MODEL ? { defaultModel: env.OPENDND_LLM_MODEL } : {}),
    ...(env.OPENDND_LLM_CACHE
      ? { cache: new FileCache(env.OPENDND_LLM_CACHE) }
      : {}),
    ...(options.ledger ? { ledger: options.ledger } : {}),
    ...(Number.isFinite(budgetDollars) && budgetDollars > 0
      ? { budget: Budget.dollars(budgetDollars) }
      : {}),
    ...(Number.isFinite(margin) && env.OPENDND_LLM_MARGIN ? { margin } : {}),
    ...(options.world ? { world: options.world } : {}),
    ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
  });
}

/** Catalogue entries with the same id replaced, new ones appended. */
export function mergeModels(
  base: readonly ModelSpec[],
  json: string | undefined,
): ModelSpec[] {
  if (!json) return [...base];
  const overrides = parse<ModelSpec[]>(json, 'OPENDND_LLM_MODELS');
  const byId = new Map(base.map((m) => [m.id, m]));
  for (const model of overrides) byId.set(model.id, model);
  return [...byId.values()];
}

/**
 * Task configuration merged field by field, so naming a model for one task
 * does not throw away the voice it is written in.
 */
export function mergeTasks(
  base: Readonly<Record<string, Task>>,
  json: string | undefined,
): Record<string, Task> {
  if (!json) return { ...base };
  const overrides = parse<Record<string, Task>>(json, 'OPENDND_LLM_TASKS');
  const out: Record<string, Task> = { ...base };
  for (const [name, override] of Object.entries(overrides)) {
    out[name] = { ...asTaskConfig(out[name]), ...asTaskConfig(override) };
  }
  return out;
}

function parse<T>(json: string, name: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (cause) {
    throw new Error(`${name} is not valid JSON`, { cause });
  }
}
