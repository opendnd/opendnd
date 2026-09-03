import { Rng } from '@opendnd/random';

/**
 * Character-level Markov chain name generator.
 *
 * The chain learns, from a list of example names, how many words a name has,
 * how long each word is, which letter starts a word, and which letter follows
 * which. Counts are weighted by `count ** 1.3` so common transitions dominate
 * without erasing rare ones.
 *
 * Algorithm originally written and released to the public domain by
 * drow <drow@bin.sh> (CC0, http://creativecommons.org/publicdomain/zero/1.0/).
 */
export interface MarkovChain {
  /** Weighted transition tables: key -> token -> weight. */
  readonly tables: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Total weight per key, for sampling. */
  readonly totals: ReadonlyMap<string, number>;
}

const PARTS = ' parts';
const LENGTH = ' length';
const INITIAL = ' initial';

/** Build a chain from example names. Multi-word names teach word count. */
export function buildChain(names: readonly string[]): MarkovChain {
  const counts = new Map<string, Map<string, number>>();
  const incr = (key: string, token: string) => {
    let table = counts.get(key);
    if (!table) {
      table = new Map();
      counts.set(key, table);
    }
    table.set(token, (table.get(token) ?? 0) + 1);
  };

  for (const raw of names) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    incr(PARTS, String(words.length));
    for (const word of words) {
      const chars = [...word];
      incr(LENGTH, String(chars.length));
      incr(INITIAL, chars[0]);
      for (let i = 1; i < chars.length; i++) incr(chars[i - 1], chars[i]);
    }
  }

  const tables = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const [key, table] of counts) {
    const scaled = new Map<string, number>();
    let total = 0;
    for (const [token, count] of table) {
      const weight = Math.floor(count ** 1.3);
      scaled.set(token, weight);
      total += weight;
    }
    tables.set(key, scaled);
    totals.set(key, total);
  }
  return { tables, totals };
}

/** Generate one name from a chain. Deterministic for a given Rng state. */
export function generateName(chain: MarkovChain, rng: Rng): string {
  if (!chain.tables.has(PARTS)) return '';
  const parts = Number(select(chain, PARTS, rng));
  const words: string[] = [];
  for (let p = 0; p < parts; p++) {
    const length = Number(select(chain, LENGTH, rng));
    let last = select(chain, INITIAL, rng);
    let word = last;
    while ([...word].length < length) {
      // A letter that only ever ended a word has no successors: stop early.
      if (!chain.tables.has(last)) break;
      last = select(chain, last, rng);
      word += last;
    }
    words.push(word);
  }
  return words.join(' ');
}

function select(chain: MarkovChain, key: string, rng: Rng): string {
  const table = chain.tables.get(key);
  const total = chain.totals.get(key);
  if (!table || total === undefined) {
    throw new Error(`Markov chain has no table for key ${JSON.stringify(key)}`);
  }
  let x = Math.floor(rng.next() * total);
  let lastToken = '';
  for (const [token, weight] of table) {
    lastToken = token;
    if (x < weight) return token;
    x -= weight;
  }
  return lastToken;
}
