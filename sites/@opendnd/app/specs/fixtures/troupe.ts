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
  const named = model && model[0]!.toUpperCase() + model.slice(1);
  return {
    type: 'object',
    properties: {
      type: named ? { const: named } : { type: 'string' },
      id: { type: 'string', format: 'uuid' },
      display: { type: 'string' },
    },
    required: ['type', 'id'],
    additionalProperties: false,
  };
}

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
      required: ['id', 'world', 'meta', ...required],
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

const meta = { versionId: '1', lastUpdated: '2026-09-02T10:00:00.000Z' };

export const storedTroupe = {
  id: TROUPE_ID,
  resourceType: 'Troupe',
  name: 'The Lantern Players',
  canonStatus: 'canon',
  meta,
};

export const storedShow = {
  id: SHOW_ID,
  resourceType: 'Show',
  name: 'Opening Night',
  canonStatus: 'canon',
  troupe: { type: 'Troupe', id: TROUPE_ID, display: 'The Lantern Players' },
  playedOn: '2026-03-14',
  produced: [
    { type: 'Happening', id: HAPPENING_ID, display: 'A dropped lantern' },
  ],
  meta,
};

export const laterShow = {
  id: LATER_SHOW_ID,
  resourceType: 'Show',
  name: 'Second Night',
  canonStatus: 'proposed',
  troupe: { type: 'Troupe', id: TROUPE_ID, display: 'The Lantern Players' },
  playedOn: '2026-03-21',
  meta,
};
