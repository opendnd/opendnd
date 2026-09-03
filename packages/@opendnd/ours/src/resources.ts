import { z } from 'zod';

/**
 * OURS (Open Unified Resource Standard) resource shapes.
 *
 * OURS is FHIR-flavoured JSON: every resource carries `resourceType`, `id`,
 * `url`, `version` and is published either standalone or inside a FHIR
 * `Bundle` of type `collection`. See https://ours.dev.
 */

/** Fields shared by every OURS resource. */
export const oursResourceBaseSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  version: z.string().min(1),
  publisher: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

/** Which external system a model or vocabulary aligns to, and how. */
export const mapsToSchema = z.object({
  /** The external system, e.g. https://schema.org or http://hl7.org/fhir */
  system: z.url(),
  /** The external schema or class IRI, e.g. https://schema.org/Person */
  schema: z.url(),
  /** A StructureMap or ConceptMap that performs the mapping, when one exists. */
  mapping: z.url().optional(),
  type: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'partial']),
  /** Free-text note on how the alignment should be read. */
  comment: z.string().optional(),
});
export type MapsTo = z.infer<typeof mapsToSchema>;

/** A named relationship from one model to another. */
export const relationshipSchema = z.object({
  predicate: z.string().min(1),
  /** The target model name (or id). */
  target: z.string().min(1),
  description: z.string().optional(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

/** The well-known root file: where to fetch models, vocabularies and mappings. */
export const ontologySchema = oursResourceBaseSchema.extend({
  resourceType: z.literal('Ontology'),
  publisher: z.string(),
  models: z.url(),
  vocabularies: z.url(),
  mappings: z.url().optional(),
});
export type Ontology = z.infer<typeof ontologySchema>;

/** A model: semantic meaning plus a pointer to the structural JSON Schema. */
export const modelSchema = oursResourceBaseSchema.extend({
  resourceType: z.literal('Model'),
  system: z.string().min(1),
  name: z.string().min(1),
  schema: z.url(),
  relationships: z.array(relationshipSchema).optional(),
  mapsTo: z.array(mapsToSchema).optional(),
});
export type Model = z.infer<typeof modelSchema>;

export const codeSchema = z.object({
  code: z.string().min(1),
  display: z.string().min(1),
  definition: z.string().optional(),
});
export type Code = z.infer<typeof codeSchema>;

/** A vocabulary: an inline code list, or a reference to an external one. */
export const vocabularySchema = oursResourceBaseSchema.extend({
  resourceType: z.literal('Vocabulary'),
  system: z.string().min(1),
  name: z.string().min(1),
  codes: z.array(codeSchema).optional(),
  mapsTo: z.array(mapsToSchema).optional(),
});
export type Vocabulary = z.infer<typeof vocabularySchema>;

export const oursResourceSchema = z.discriminatedUnion('resourceType', [
  ontologySchema,
  modelSchema,
  vocabularySchema,
]);
export type OursResource = z.infer<typeof oursResourceSchema>;

/** A FHIR-style collection bundle of OURS resources. */
export const bundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  type: z.literal('collection'),
  entry: z.array(
    z.object({
      fullUrl: z.url(),
      resource: oursResourceSchema,
    }),
  ),
});
export type Bundle = z.infer<typeof bundleSchema>;

/**
 * The subset of JSON Schema (draft 2020-12) that OURS models may use and that
 * the code generator understands. Kept deliberately small so every schema
 * round-trips to TypeScript and Zod without surprises.
 */
export interface JsonSchema {
  $id?: string;
  $schema?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  title?: string;
  description?: string;
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  /** OURS extension: the URL of a Vocabulary whose codes constrain this string. */
  'x-ours-vocabulary'?: string;
}
export type JsonSchemaType =
  'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
