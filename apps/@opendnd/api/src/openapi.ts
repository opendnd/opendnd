import { type ModelId, models } from '@opendnd/types';
import { toJSONSchema } from 'zod';
import { canGenerate } from './generate';

/**
 * The OpenAPI description, generated from the ontology.
 *
 * It comes from the same Zod schemas the routes validate against, so the
 * documentation cannot drift from the behaviour: a model added to the
 * ontology appears here with its routes and its schema, and a field renamed
 * in the ontology is renamed here.
 */
export function openApiDocument(options: { url?: string } = {}) {
  const ids = Object.keys(models) as ModelId[];
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (const id of ids) {
    const { $schema: _ignored, ...schema } = toJSONSchema(models[id], {
      target: 'draft-2020-12',
      io: 'output',
      // References between models are resolved inline: an OpenAPI reader
      // should not have to fetch the ontology to understand a body.
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    schemas[id] = schema;

    const tag = id;
    const ref = { $ref: `#/components/schemas/${id}` };
    paths[`/v1/worlds/{world}/${id}`] = {
      parameters: [world, ...reads],
      get: {
        tags: [tag],
        summary: `List ${id} resources in a world`,
        parameters: filters,
        responses: page(id, ref),
      },
      post: {
        tags: [tag],
        summary: `Create a ${id}`,
        requestBody: body(ref),
        responses: {
          201: { description: 'Created', content: json(ref) },
          400: problem('The body does not satisfy the schema'),
        },
      },
    };
    paths[`/v1/worlds/{world}/${id}/{id}`] = {
      parameters: [world, identifier, ...reads],
      get: {
        tags: [tag],
        summary: `Read one ${id}`,
        responses: { 200: { description: 'The resource', content: json(ref) } },
      },
      put: {
        tags: [tag],
        summary: `Replace one ${id}`,
        requestBody: body(ref),
        responses: { 200: { description: 'Stored', content: json(ref) } },
      },
      patch: {
        tags: [tag],
        summary: `Merge fields into one ${id}`,
        requestBody: body({ type: 'object' }),
        responses: { 200: { description: 'Stored', content: json(ref) } },
      },
      delete: {
        tags: [tag],
        summary: `Remove one ${id} from this world`,
        responses: { 204: { description: 'Removed' } },
      },
    };
    if (canGenerate(id)) {
      paths[`/v1/${id}/$generate`] = {
        post: {
          tags: [tag],
          summary: `Generate ${id} resources without saving them`,
          description:
            'Needs no world and no account. Returns the resources stamped ' +
            'generated; post one back to keep it.',
          requestBody: body({ type: 'object' }),
          responses: {
            200: { description: 'Generated', content: json(bundle) },
          },
        },
      };
      paths[`/v1/worlds/{world}/${id}/$generate`] = {
        parameters: [world],
        post: {
          tags: [tag],
          summary: `Generate ${id} resources from this world's content`,
          requestBody: body({ type: 'object' }),
          responses: {
            200: { description: 'Generated', content: json(bundle) },
          },
        },
      };
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenDnD',
      version: '1',
      description:
        'A headless API for building fictional worlds. One route set per ' +
        'ontology model. Content belongs to a world, which is the tenant.',
    },
    ...(options.url ? { servers: [{ url: options.url }] } : {}),
    tags: ids.map((id) => ({ name: id })),
    paths: { ...fixedPaths, ...paths },
    components: {
      schemas: { ...schemas, ...fixedSchemas },
      securitySchemes: {
        cognito: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'An Amazon Cognito access or id token.',
        },
      },
    },
    security: [{ cognito: [] }],
  };
}

const world = {
  name: 'world',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'The world that owns the content.',
};

const identifier = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

/** The two time axes, which every read accepts. */
const reads = [
  {
    name: 'at',
    in: 'query',
    schema: { type: 'integer' },
    description:
      'In-world time, in years of the world calendar. Returns the state ' +
      'that held then.',
  },
  {
    name: 'asOf',
    in: 'query',
    schema: { type: 'string', format: 'date-time' },
    description:
      'Transaction time. Returns each record as it was authored at that ' +
      'moment.',
  },
];

const filters = [
  { name: 'canonStatus', in: 'query', schema: { type: 'string' } },
  { name: 'perspective', in: 'query', schema: { type: 'string' } },
  { name: 'module', in: 'query', schema: { type: 'string' } },
  { name: 'generatedBy', in: 'query', schema: { type: 'string' } },
  {
    name: 'name',
    in: 'query',
    schema: { type: 'string' },
    description: 'Case-insensitive prefix match.',
  },
  { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
  { name: 'cursor', in: 'query', schema: { type: 'string' } },
];

const bundle = { $ref: '#/components/schemas/Bundle' };

const fixedSchemas = {
  Bundle: {
    type: 'object',
    properties: { resources: { type: 'array', items: { type: 'object' } } },
    required: ['resources'],
  },
  World: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      visibility: { enum: ['private', 'link', 'public'] },
      role: { enum: ['owner', 'editor', 'viewer'] },
    },
    required: ['id', 'name', 'visibility'],
  },
  Problem: {
    type: 'object',
    properties: { error: { type: 'string' }, issues: {} },
    required: ['error'],
  },
};

const fixedPaths = {
  '/v1/models': {
    get: {
      tags: ['meta'],
      summary: 'The models this deployment serves',
      security: [],
      responses: { 200: { description: 'The model registry' } },
    },
  },
  '/v1/openapi.json': {
    get: {
      tags: ['meta'],
      summary: 'This document',
      security: [],
      responses: { 200: { description: 'The OpenAPI description' } },
    },
  },
  '/v1/worlds': {
    get: {
      tags: ['worlds'],
      summary: "The caller's worlds",
      responses: {
        200: { description: 'Worlds the caller belongs to' },
        401: problem('This request needs an account'),
      },
    },
    post: {
      tags: ['worlds'],
      summary: 'Create a world',
      requestBody: body({
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          visibility: { enum: ['private', 'link', 'public'] },
        },
        required: ['name'],
      }),
      responses: {
        201: {
          description: 'Created',
          content: json({ $ref: '#/components/schemas/World' }),
        },
      },
    },
  },
  '/v1/worlds/{world}/members': {
    parameters: [world],
    post: {
      tags: ['worlds'],
      summary: 'Admit someone to a world, or change their role',
      requestBody: body({
        type: 'object',
        properties: {
          subject: { type: 'string' },
          role: { enum: ['owner', 'editor', 'viewer'] },
        },
        required: ['subject', 'role'],
      }),
      responses: { 204: { description: 'Set' } },
    },
  },
  '/v1/worlds/{world}/{model}/{id}/$simulate': {
    parameters: [
      world,
      {
        name: 'model',
        in: 'path',
        required: true,
        schema: { enum: ['world', 'faction', 'place'] },
      },
      identifier,
    ],
    post: {
      tags: ['meta'],
      summary: 'Run the history simulation over a world, a house or a place',
      requestBody: body({
        type: 'object',
        properties: {
          years: { type: 'integer', minimum: 1, maximum: 1000 },
          startYear: { type: 'integer' },
          save: {
            type: 'boolean',
            description:
              'Save the produced resources. Left false, they are returned ' +
              'and nothing is written.',
          },
          calendar: { type: 'string', format: 'uuid' },
          species: { type: 'string', format: 'uuid' },
          culture: { type: 'string', format: 'uuid' },
          params: { type: 'object' },
        },
      }),
      responses: { 200: { description: 'What the run produced' } },
    },
  },
  '/v1/worlds/{world}/$export/{format}': {
    parameters: [
      world,
      {
        name: 'format',
        in: 'path',
        required: true,
        schema: { enum: ['json', 'markdown'] },
      },
    ],
    get: {
      tags: ['meta'],
      summary: 'Export everything in a world',
      responses: { 200: { description: 'The export' } },
    },
  },
};

function json(schema: unknown) {
  return { 'application/json': { schema } };
}

function body(schema: unknown) {
  return { required: true, content: json(schema) };
}

function page(id: string, ref: unknown) {
  return {
    200: {
      description: `A page of ${id} resources`,
      content: json({
        type: 'object',
        properties: {
          resources: { type: 'array', items: ref },
          next: { type: 'string' },
        },
        required: ['resources'],
      }),
    },
  };
}

function problem(description: string) {
  return {
    description,
    content: json({ $ref: '#/components/schemas/Problem' }),
  };
}
