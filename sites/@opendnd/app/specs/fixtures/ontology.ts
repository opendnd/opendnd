import type { ModelInfo, Vocabulary } from 'src/api/types';
import {
  type JsonSchema,
  type Ontology,
  type OpenApiDocument,
  ontologyFrom,
} from 'src/schema/openapi';

/**
 * An invented model, shaped the way the API's OpenAPI description shapes the
 * real ones: one inlined schema per model, an `Input` variant without the
 * server-set fields, and a hoisted definition for anything recursive.
 */
const reference: JsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    id: { type: 'string', format: 'uuid' },
    display: { type: 'string' },
  },
  required: ['type', 'id'],
  additionalProperties: false,
};

const stored: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  resourceType: { type: 'string', readOnly: true },
  world: { type: 'string', format: 'uuid', readOnly: true },
  meta: {
    type: 'object',
    readOnly: true,
    properties: {
      versionId: { type: 'string' },
      lastUpdated: { type: 'string', format: 'date-time' },
    },
    required: ['versionId', 'lastUpdated'],
  },
};

const authored: Record<string, JsonSchema> = {
  name: { type: 'string', minLength: 1 },
  description: { type: 'string' },
  canonStatus: { type: 'string', enum: ['canon', 'proposed'] },
  perspective: {
    type: 'string',
    enum: ['in-universe', 'out-of-universe'],
    default: 'in-universe',
  },
  mood: {
    type: 'string',
    enum: ['happy', 'sad'],
    description: 'How the pet feels.',
  },
  colour: { type: 'string', enum: ['red-brown', 'grey'] },
  legs: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
  weight: { type: 'number' },
  friendly: { type: 'boolean' },
  owner: reference,
  friends: { type: 'array', items: reference },
  tricks: { type: 'array', items: { type: 'string' } },
  born: {
    type: 'object',
    properties: {
      trs: { type: 'string', format: 'uuid' },
      year: { type: 'integer' },
      precision: { type: 'string', enum: ['year', 'day'], default: 'year' },
    },
    required: ['trs', 'precision'],
    additionalProperties: false,
  },
  home: {
    type: 'object',
    properties: { name: { type: 'string' } },
  },
  extras: { type: 'object', additionalProperties: true },
  shape: {
    anyOf: [
      { type: 'string' },
      { type: 'object', properties: { r: { type: 'number' } } },
    ],
  },
  choice: {
    $ref: '#/components/schemas/pet___schema0',
    description: 'A nested choice.',
  },
  seen: { type: 'string', format: 'date-time' },
};

export const petDocument: OpenApiDocument = {
  components: {
    schemas: {
      pet: {
        type: 'object',
        description: 'A companion animal.',
        properties: { ...stored, ...authored },
        required: [
          'id',
          'world',
          'name',
          'canonStatus',
          'perspective',
          'meta',
          'mood',
        ],
      },
      petInput: {
        type: 'object',
        description: 'A companion animal. (As sent by a client.)',
        properties: authored,
        required: ['name', 'canonStatus', 'perspective', 'mood'],
      },
      pet___schema0: {
        type: 'object',
        properties: {
          choose: { type: 'integer', minimum: 1 },
          options: {
            type: 'array',
            items: { $ref: '#/components/schemas/pet___schema0' },
          },
        },
        required: ['choose'],
      },
    },
  },
};

export const petModels: ModelInfo[] = [
  {
    id: 'pet',
    name: 'Pet',
    description: 'A companion animal.',
    generate: {
      description: 'A pet with a mood, belonging to someone.',
      input: {
        type: 'object',
        properties: {
          owner: {
            type: 'object',
            description: 'Whose pet it is.',
            properties: {
              type: { const: 'Character' },
              id: { type: 'string', format: 'uuid' },
              display: { type: 'string' },
            },
            required: ['type', 'id'],
            additionalProperties: false,
          },
          mood: { type: 'string', enum: ['happy', 'sad'] },
          count: { type: 'integer', minimum: 1, description: 'How many.' },
        },
        required: ['owner'],
        additionalProperties: false,
      },
    },
  },
  { id: 'character', name: 'Character' },
];

export const petVocabularies: Vocabulary[] = [
  {
    id: 'mood',
    name: 'Mood',
    codes: [
      { code: 'happy', display: 'Happy' },
      { code: 'sad', display: 'Sad' },
    ],
  },
  // Two vocabularies with the same codes: neither can label a schema.
  {
    id: 'agreement',
    name: 'Agreement',
    codes: [
      { code: 'canon', display: 'Agreed' },
      { code: 'proposed', display: 'Suggested' },
    ],
  },
  {
    id: 'canon-status',
    name: 'Canon status',
    codes: [
      { code: 'canon', display: 'Canon' },
      { code: 'proposed', display: 'Proposed' },
    ],
  },
];

export function petOntology(): Ontology {
  return ontologyFrom(petDocument, petModels, petVocabularies);
}

export const OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
export const PET_ID = '33333333-3333-4333-8333-333333333333';
export const WORLD_ID = '44444444-4444-4444-8444-444444444444';

export const storedPet = {
  id: PET_ID,
  resourceType: 'Pet',
  world: WORLD_ID,
  name: 'Biscuit',
  description: 'A small dog.\n\nFond of shoes.',
  canonStatus: 'canon',
  perspective: 'in-universe',
  mood: 'happy',
  legs: 4,
  friendly: true,
  owner: { type: 'Character', id: OWNER_ID, display: 'Ada' },
  friends: [{ type: 'Pet', id: FRIEND_ID, display: 'Crumb' }],
  tricks: ['sit', 'roll over'],
  born: { trs: OWNER_ID, year: 1041, precision: 'year' },
  extras: { collar: 'red' },
  unknownField: { deep: [1, 2] },
  meta: { versionId: '2', lastUpdated: '2026-09-02T10:00:00.000Z' },
};
