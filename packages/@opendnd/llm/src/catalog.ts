import type { ModelSpec } from './model';
import type { Task } from './models';

/**
 * The five things OpenDnD asks a language model to do. A task carries the
 * voice the work is written in and how long it may run; which model does it
 * is configuration, and belongs to whoever is running this.
 */
export const TASKS = [
  /** Turn a run of events into prose for the Codex. */
  'chronicle',
  /** Short descriptive text for one place, person or thing. */
  'describe',
  /** Author an ontology resource against its schema. */
  'author',
  /** Read prose for contradictions against the record. */
  'review',
  /** Vectors for search. */
  'embed',
] as const;

export type TaskName = (typeof TASKS)[number];

/**
 * Reference data for some models people are likely to name: their provider,
 * their limits, and what they cost. It is a catalogue, not a menu: a model
 * absent from it can still be used, and a local id absent from it is taken
 * as a tag on the user's own Ollama.
 *
 * Model identifiers and prices are configuration, not facts. Check both
 * against the provider's current lists before charging anyone, and override
 * them with `OPENDND_LLM_MODELS` rather than editing this catalogue. Prices
 * are US dollars per million tokens.
 */
export const KNOWN_MODELS: readonly ModelSpec[] = [
  // Local, through Ollama. Ids are the tags the user pulls, so what they see
  // in `ollama list` is what they can name here. Nothing local has a price.
  {
    id: 'llama3.1:8b',
    provider: 'ollama',
    modelId: 'llama3.1:8b',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ['schema'],
  },
  {
    id: 'qwen2.5:32b',
    provider: 'ollama',
    modelId: 'qwen2.5:32b',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ['schema', 'tools'],
  },
  {
    id: 'nomic-embed-text',
    provider: 'ollama',
    modelId: 'nomic-embed-text',
    contextWindow: 8192,
    capabilities: ['embedding'],
  },
  // Hosted, through Bedrock.
  {
    id: 'claude-haiku',
    provider: 'bedrock',
    modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ['schema', 'tools', 'vision'],
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4 },
  },
  {
    id: 'claude-sonnet',
    provider: 'bedrock',
    modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ['schema', 'tools', 'vision'],
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
  },
  {
    id: 'titan-embed',
    provider: 'bedrock',
    modelId: 'amazon.titan-embed-text-v2:0',
    contextWindow: 8192,
    capabilities: ['embedding'],
    pricing: { inputPerMillion: 0.02, outputPerMillion: 0 },
  },
];

/**
 * How each task is written, with no model named: the model comes from
 * `OPENDND_LLM_TASKS`, from `OPENDND_LLM_MODEL`, or from the call itself.
 * The system prompts are the house voice, and are defaults a world, a module
 * or a single call can replace.
 */
export const DEFAULT_TASKS: Readonly<Record<TaskName, Task>> = {
  chronicle: {
    system:
      'You are a chronicler of a fictional world. Write plainly, in the ' +
      'register of a historian working from records. State only what the ' +
      'given events support; where the record is silent, say so or leave it ' +
      'out. No modern idiom, no summary of your own reasoning.',
    temperature: 0.7,
    maxTokens: 2048,
    // Prose does not need deliberation, and a reasoning model given this
    // budget will spend all of it thinking and return nothing.
    think: false,
  },
  describe: {
    system:
      'Describe one thing in a fictional world concretely and briefly: what ' +
      'a person standing there would notice first. No lists, no adjectives ' +
      'piled up, no invented proper names beyond those given.',
    temperature: 0.8,
    maxTokens: 400,
    think: false,
  },
  author: {
    system:
      'You author records for a fictional world against a schema. Fill only ' +
      'fields the given material supports, leave the rest out, and invent ' +
      'nothing that contradicts what you were given. Return JSON only.',
    temperature: 0.4,
    maxTokens: 4096,
  },
  review: {
    system:
      'You check prose about a fictional world against its records and ' +
      'report contradictions. Report only what the records actually ' +
      'contradict, quote the passage at fault, and prefer silence to a ' +
      'guess. Return JSON only.',
    temperature: 0.1,
    maxTokens: 4096,
  },
  embed: {},
};
