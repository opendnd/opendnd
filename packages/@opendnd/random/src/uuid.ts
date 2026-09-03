/* eslint-disable no-bitwise -- bit operations are the point of a PRNG and of UUID layout */
import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 4122 name-based UUID (version 5, SHA-1). */
export function uuidV5(namespace: string, name: string): string {
  if (!UUID.test(namespace)) {
    throw new SyntaxError(`uuidV5(): namespace "${namespace}" is not a UUID`);
  }
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The RFC 4122 DNS namespace. */
export const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** The OpenDnD namespace: the DNS namespace applied to `opendnd.org`. */
export const NAMESPACE_OPENDND = uuidV5(NAMESPACE_DNS, 'opendnd.org');

/**
 * The deterministic `derivedId` of a generated resource: the world is the
 * namespace and the provenance seed path is the name, so regenerating the
 * same seed in the same world yields the same id while the random `id` on
 * the record itself stays free to survive edits.
 */
export function derivedId(worldId: string, seedPath: string): string {
  return uuidV5(worldId, seedPath);
}
