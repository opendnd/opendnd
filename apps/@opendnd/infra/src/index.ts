/**
 * @opendnd/infra — the AWS deployment.
 *
 * Two stacks per stage. The persistent one holds what a deployment must not
 * be able to destroy: the user pool, the connection secrets and the asset
 * bucket. The service one holds what is meant to be replaced: the API on
 * Lambda behind an HTTP API, the event bus and the publisher that drains the
 * outbox onto it.
 *
 * There is no VPC, because the database is a managed endpoint reached over
 * TLS. See ADR-012.
 */
export * from './config';
export * from './persistent-stack';
export * from './service-stack';
