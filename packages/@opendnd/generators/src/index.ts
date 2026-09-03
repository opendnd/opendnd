/**
 * @opendnd/generators — deterministic content generators.
 *
 * Every generator implements the {@link Generator} contract: typed input plus
 * a {@link GeneratorContext} (world, seed path, Rng) in, output out, with
 * `stamp()` supplying the platform fields (reproducible id, derived id,
 * canon status `generated`, provenance) on any resource produced.
 *
 * - `names`: Markov-chain names learned from a Culture.
 * - `genetics`: d20 genetics driven by a Species.
 * - `person`: a whole Person from a Species and a Culture.
 */
export * from './generator';
export * from './names';
export * from './genetics';
export * from './person';
