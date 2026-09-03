/**
 * @opendnd/simulation — the history simulation and its consistency checker.
 * See ADR-007 and ADR-008.
 */
export * from './types';
export * from './lifecycle';
export * from './state';
export * from './resources';
export * from './checker';
export * from './history';
export { demographics } from './systems/demographics';
export { succession, chooseHeir } from './systems/succession';
