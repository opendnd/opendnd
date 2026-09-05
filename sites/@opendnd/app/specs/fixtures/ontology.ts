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
    model: { type: 'string' },
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
  },
  required: ['model', 'id'],
  additionalProperties: false,
};

const stored: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  model: { type: 'string', readOnly: true },
  world: { type: 'string', format: 'uuid', readOnly: true },
  recorded: {
    type: 'object',
    readOnly: true,
    properties: {
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      revision: { type: 'integer' },
    },
    required: ['createdAt', 'updatedAt', 'revision'],
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
          'recorded',
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

export const petModels: ModelInfo[] = [{ id: 'pet', generate: false }];

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
  model: 'pet',
  world: WORLD_ID,
  name: 'Biscuit',
  description: 'A small dog.\n\nFond of shoes.',
  canonStatus: 'canon',
  perspective: 'in-universe',
  mood: 'happy',
  legs: 4,
  friendly: true,
  owner: { model: 'person', id: OWNER_ID, name: 'Ada' },
  friends: [{ model: 'pet', id: FRIEND_ID, name: 'Crumb' }],
  tricks: ['sit', 'roll over'],
  born: { trs: OWNER_ID, year: 1041, precision: 'year' },
  extras: { collar: 'red' },
  unknownField: { deep: [1, 2] },
  recorded: {
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    revision: 2,
  },
};
