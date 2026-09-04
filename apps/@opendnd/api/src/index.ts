/**
 * @opendnd/api — the headless API.
 *
 * One route set per ontology model, generated from the model registry, over a
 * store in which a world is the tenant: content belongs to a world, a user
 * belongs to many, and a world reads its own content layered over the modules
 * it enables. Isolation is enforced by the database rather than by the
 * request path, so a query that forgets to scope itself returns nothing.
 *
 * See ADR-009 for the shape of the routes and ADR-011 for the tenancy.
 */
export * from './db';
export * from './identity';
export * from './worlds';
export * from './store';
export * from './generate';
export * from './simulate';
export * from './openapi';
export * from './outbox';
export * from './export';
export * from './secrets';
export * from './sinks/eventbridge';
export * from './app';
