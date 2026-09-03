import { Rng } from '@opendnd/random';
import type { Culture, NameType } from '@opendnd/types';
import { MarkovChain, buildChain, generateName } from './markov';

/** The part of a Culture the name generator needs. */
export type CultureNames = Pick<Culture, 'id' | 'name' | 'names'>;

/**
 * Name generator for one culture. Chains are built lazily per name type and
 * cached, so one NameGenerator can hand out many names cheaply.
 */
export class NameGenerator {
  private readonly chains = new Map<NameType, MarkovChain>();

  constructor(readonly culture: CultureNames) {}

  /** Name types this culture has example names for. */
  types(): NameType[] {
    const names = this.culture.names ?? {};
    return (Object.keys(names) as NameType[]).filter(
      (t) => (names[t]?.length ?? 0) > 0,
    );
  }

  has(type: NameType): boolean {
    return (this.culture.names?.[type]?.length ?? 0) > 0;
  }

  /** One name of the given type. */
  generate(type: NameType, rng: Rng): string {
    return generateName(this.chain(type), rng);
  }

  /** Up to `count` distinct names of the given type. */
  list(type: NameType, rng: Rng, count: number): string[] {
    const chain = this.chain(type);
    const out = new Set<string>();
    let attempts = 0;
    while (out.size < count && attempts < count * 20) {
      out.add(generateName(chain, rng));
      attempts++;
    }
    return [...out];
  }

  private chain(type: NameType): MarkovChain {
    let chain = this.chains.get(type);
    if (!chain) {
      const list = this.culture.names?.[type];
      if (!list || list.length === 0) {
        throw new Error(
          `Culture "${this.culture.name}" has no ${type} names to learn from`,
        );
      }
      chain = buildChain(list);
      this.chains.set(type, chain);
    }
    return chain;
  }
}

/** Convenience: the name a seed path produces for a culture and type. */
export function nameFor(
  culture: CultureNames,
  type: NameType,
  seed: string,
): string {
  return new NameGenerator(culture).generate(type, new Rng(seed));
}
