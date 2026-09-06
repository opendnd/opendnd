import type { ModelInfo } from 'src/api/types';
import {
  type JsonSchema,
  type Ontology,
  type OpenApiDocument,
  ontologyFrom,
} from 'src/schema/openapi';

/**
 * Three invented models that refer to one another, for the parts of the
 * application that follow references between records: a troupe, the shows
 * it puts on, and the happenings a show produces.
 */
function reference(model?: string): JsonSchema {
  return {
    type: 'object',
    properties: {
      model: model ? { const: model } : { type: 'string' },
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
    },
    required: ['model', 'id'],
    additionalProperties: false,
  };
}

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

const troupe: Record<string, JsonSchema> = {
  name: { type: 'string', minLength: 1 },
  canonStatus: { type: 'string', enum: ['canon', 'proposed'] },
  players: { type: 'array', items: reference('player') },
};

const show: Record<string, JsonSchema> = {
  name: { type: 'string', minLength: 1 },
  canonStatus: { type: 'string', enum: ['canon', 'proposed'] },
  troupe: { ...reference('troupe'), description: 'Who put it on.' },
  playedOn: { type: 'string', format: 'date' },
  produced: {
    type: 'array',
    items: reference('happening'),
    description: 'What the show brought about.',
  },
  about: { type: 'array', items: reference() },
};

const happening: Record<string, JsonSchema> = {
  name: { type: 'string', minLength: 1 },
  canonStatus: { type: 'string', enum: ['canon', 'proposed'] },
  when: { type: 'string', format: 'date-time' },
};

const player: Record<string, JsonSchema> = {
  name: { type: 'string', minLength: 1 },
  canonStatus: { type: 'string', enum: ['canon', 'proposed'] },
  troupe: reference('troupe'),
  understudyOf: reference('player'),
  standsInFor: reference('player'),
};

function model(fields: Record<string, JsonSchema>, required: string[]) {
  return {
    full: {
      type: 'object',
      properties: { ...stored, ...fields },
      required: ['id', 'world', 'recorded', ...required],
    } as JsonSchema,
    input: {
      type: 'object',
      properties: fields,
      required,
    } as JsonSchema,
  };
}

const troupeModel = model(troupe, ['name']);
const showModel = model(show, ['name', 'troupe']);
const happeningModel = model(happening, ['name']);
const playerModel = model(player, ['name']);

export const troupeDocument: OpenApiDocument = {
  components: {
    schemas: {
      troupe: troupeModel.full,
      troupeInput: troupeModel.input,
      show: showModel.full,
      showInput: showModel.input,
      happening: happeningModel.full,
      happeningInput: happeningModel.input,
      player: playerModel.full,
      playerInput: playerModel.input,
    },
  },
};

export const troupeModels: ModelInfo[] = [
  { id: 'troupe', name: 'Troupe' },
  { id: 'show', name: 'Show' },
  { id: 'happening', name: 'Happening' },
  { id: 'player', name: 'Player' },
];

export function troupeOntology(): Ontology {
  return ontologyFrom(troupeDocument, troupeModels, [
    {
      id: 'canon-status',
      name: 'Canon status',
      codes: [
        { code: 'canon', display: 'Canon' },
        { code: 'proposed', display: 'Proposed' },
      ],
    },
  ]);
}

export const TROUPE_ID = '55555555-5555-4555-8555-555555555555';
export const SHOW_ID = '66666666-6666-4666-8666-666666666666';
export const LATER_SHOW_ID = '77777777-7777-4777-8777-777777777777';
export const HAPPENING_ID = '88888888-8888-4888-8888-888888888888';

const recorded = {
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  revision: 1,
};

export const storedTroupe = {
  id: TROUPE_ID,
  model: 'troupe',
  name: 'The Lantern Players',
  canonStatus: 'canon',
  recorded,
};

export const storedShow = {
  id: SHOW_ID,
  model: 'show',
  name: 'Opening Night',
  canonStatus: 'canon',
  troupe: { model: 'troupe', id: TROUPE_ID, name: 'The Lantern Players' },
  playedOn: '2026-03-14',
  produced: [
    { model: 'happening', id: HAPPENING_ID, name: 'A dropped lantern' },
  ],
  recorded,
};

export const laterShow = {
  id: LATER_SHOW_ID,
  model: 'show',
  name: 'Second Night',
  canonStatus: 'proposed',
  troupe: { model: 'troupe', id: TROUPE_ID, name: 'The Lantern Players' },
  playedOn: '2026-03-21',
  recorded,
};
