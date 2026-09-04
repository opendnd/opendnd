/**
 * @opendnd/llm — one way in to every language model.
 *
 * A caller names a task and, when it wants to, a model: `complete('chronicle',
 * request, { model: 'gemma4:26b' })`. Which model that is comes from the call,
 * from the task's configuration, or from the deployment default, in that
 * order; a model that fails is reported rather than replaced, and
 * `available()` lists what the configured endpoints can serve so a person can
 * be offered the choice.
 *
 * The rest is the plumbing every model call needs.
 *
 * - `Provider`: Ollama, Bedrock, and any OpenAI-compatible or Anthropic endpoint.
 * - `Models`: one interface over all of them, with retries, cache and cost.
 * - `structured`: a reply validated against a Zod schema, repaired if it misses.
 * - `Ledger`: what each call cost and what it is charged at.
 *
 * The package knows nothing about worlds; it is domain-agnostic on purpose.
 */
export * from './message';
export * from './model';
export * from './provider';
export * from './http';
export * from './cache';
export * from './ledger';
export * from './models';
export * from './structured';
export * from './catalog';
export * from './env';
export * from './providers/sigv4';
export * from './providers/ollama';
export * from './providers/openai';
export * from './providers/anthropic';
export * from './providers/bedrock';
