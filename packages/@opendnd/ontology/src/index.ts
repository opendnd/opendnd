import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @opendnd/ontology — the OpenDnD worldbuilding ontology, authored in OURS.
 *
 * The bundle lives in this package's `ours/` directory:
 *
 * - `ontology.json`: the well-known root.
 * - `models/*.json`: one OURS Model per resource type, each pointing at a
 *   JSON Schema and carrying `mapsTo` alignments to schema.org, Wikidata,
 *   CIDOC-CRM, OWL-Time, GEDCOM X and GeoSPARQL.
 * - `schemas/*.schema.json`: the JSON Schemas. `common.schema.json` holds the
 *   platform base every resource extends (in-world time, transaction time,
 *   canon status, perspective, provenance).
 * - `vocabularies/*.json`: inline code lists referenced from schemas via the
 *   `$ref` to the schema published beside each vocabulary.
 *
 * Load it with `loadOursDirectory(OURS_DIR)` from `@opendnd/ours`. See ADR-002.
 */
export const ONTOLOGY_URL =
  'https://docs.opendnd.org/ours/ontology.json' as const;

/** Absolute path to the OURS bundle directory, valid from source and from dist. */
export const OURS_DIR: string = (() => {
  for (const candidate of [
    resolve(__dirname, '..', 'ours'),
    resolve(__dirname, '..', '..', 'ours'),
  ]) {
    if (existsSync(resolve(candidate, 'ontology.json'))) return candidate;
  }
  throw new Error('@opendnd/ontology: ours/ directory not found');
})();
