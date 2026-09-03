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
 * - `settlement`: a place with terrain, resources, area, population and economy.
 * - `realm`: nested demesnes with ruling houses and ranked titles.
 */
export * from './generator';
export * from './alignment';
export * from './names';
export * from './genetics';
export * from './person';
export * from './settlement';
