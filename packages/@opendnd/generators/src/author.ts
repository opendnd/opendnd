import type { ModelResponse, Models } from '@opendnd/llm';
import type { Provenance, Reference, ResourceBase } from '@opendnd/types';
import { GeneratorContext, stamp } from './generator';

/**
 * A generator context with a way to reach a model, and the model the caller
 * chose, when they chose one.
 */
export interface AuthorContext extends GeneratorContext {
  readonly models: Models;
  /** The model to use, when the caller picked one. */
  readonly model?: string;
}

/**
 * The contract for a generator that calls a language model.
 *
 * It is deliberately not the {@link Generator} contract. A `Generator` is
 * synchronous and reproducible: the same seed gives the same output for ever,
 * which is what lets a region be filled on demand and refilled identically.
 * An `Author` is asynchronous, costs money, and will not return the same
 * words twice, so it does not make that promise. What it does promise is the
 * same as any other generator: output stamped
 * `generated`, traceable to the code and the model that made it, and
 * reviewable before it becomes canon.
 */
export interface Author<Input, Output> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  /** The task, e.g. `chronicle`. Its configuration says which model, unless the caller does. */
  readonly task: string;
  author(input: Input, ctx: AuthorContext): Promise<Output>;
}

/**
 * The platform fields for an AI-authored resource: everything `stamp` gives a
 * deterministic generator, plus the hash of the prompt and the model that
 * answered.
 *
 * `generatedBy` stays the author's id and version, as it is for every other
 * generator, because that is what a reader needs to know how the record was
 * made; the model is recorded in `parameters.model`, so a world can be
 * queried for everything a given model wrote.
 */
export function stampAuthored(
  author: Pick<Author<unknown, unknown>, 'id' | 'version'>,
  ctx: GeneratorContext,
  response: Pick<ModelResponse, 'provider' | 'modelId' | 'promptHash'>,
  extra: Omit<Partial<Provenance>, 'derivedFrom'> & {
    derivedFrom?: readonly Reference[];
  } = {},
): Pick<
  ResourceBase,
  'id' | 'derivedId' | 'world' | 'canonStatus' | 'recorded' | 'provenance'
> {
  const { derivedFrom, ...rest } = extra;
  return stamp(author, ctx, {
    promptHash: response.promptHash,
    parameters: { model: `${response.provider}:${response.modelId}` },
    ...(derivedFrom && derivedFrom.length > 0
      ? { derivedFrom: [...derivedFrom] }
      : {}),
    ...rest,
  });
}
