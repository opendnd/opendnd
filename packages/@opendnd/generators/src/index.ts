/**
 * @opendnd/generators — content generators, deterministic and AI-authored.
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
 *
 * Authors are the AI half of the same idea. An {@link Author} calls a
 * language model, so it is asynchronous and does not promise the same words
 * twice; it stamps its output with the model that wrote it and the records it
 * was written from.
 *
 * - `article`: an article or chronicle about one record, for the Codex.
 */
export * from './generator';
export * from './author';
export * from './alignment';
export * from './names';
export * from './genetics';
export * from './person';
export * from './settlement';
export * from './article';
