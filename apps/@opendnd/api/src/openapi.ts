import { type ModelId, models, readOnlyFields } from '@opendnd/types';
import { toJSONSchema } from 'zod';
import { GENERATORS } from './generate';

/**
 * The OpenAPI description, generated from the ontology.
 *
 * It comes from the same Zod schemas the routes validate against, so the
 * documentation cannot drift from the behaviour: a model added to the
 * ontology appears here with its routes and its schema, and a field renamed
 * in the ontology is renamed here. Every route the application mounts is
 * described; a test holds the two lists together.
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
    schemas[id] = hoistDefinitions(id, schema, schemas);
    schemas[`${id}Input`] = inputVariant(schemas[id] as JsonObject);

    const tag = id;
    const ref = { $ref: `#/components/schemas/${id}` };
    const input = { $ref: `#/components/schemas/${id}Input` };
    paths[`/v1/worlds/{world}/${id}`] = {
      parameters: [world],
      get: {
        tags: [tag],
        summary: `List ${id} resources in a world`,
        parameters: [...reads, ...filters],
        responses: {
          ...page(id, ref),
          400: problem('A parameter is not valid'),
        },
      },
      post: {
        tags: [tag],
        summary: `Create a ${id}`,
        description:
          'The body may name its own `id`; if it does, that id must be free. ' +
          `Fields the server sets (${readOnlyFields.join(', ')}) are ignored.`,
        requestBody: body(input),
        responses: {
          201: { description: 'Created', headers: etag, content: json(ref) },
          400: problem('The body does not satisfy the schema'),
          409: problem('A resource with that id already exists'),
        },
      },
    };
    paths[`/v1/worlds/{world}/${id}/{id}`] = {
      parameters: [world, identifier],
      get: {
        tags: [tag],
        summary: `Read one ${id}`,
        parameters: reads,
        responses: {
          200: {
            description: 'The resource',
            headers: etag,
            content: json(ref),
          },
          404: problem('No such resource in this world'),
        },
      },
      put: {
        tags: [tag],
        summary: `Replace one ${id}`,
        parameters: [ifMatch],
        requestBody: body(input),
        responses: {
          200: { description: 'Stored', headers: etag, content: json(ref) },
          400: problem('The body does not satisfy the schema'),
          412: problem(
            'The resource has changed since the revision in If-Match',
          ),
        },
      },
      patch: {
        tags: [tag],
        summary: `Merge fields into one ${id}`,
        description:
          'A JSON merge patch (RFC 7396): objects merge member by member, ' +
          '`null` removes a field, and any other value replaces what was there.',
        parameters: [ifMatch],
        requestBody: body(input),
        responses: {
          200: { description: 'Stored', headers: etag, content: json(ref) },
          404: problem('No such resource in this world'),
          412: problem(
            'The resource has changed since the revision in If-Match',
          ),
        },
      },
      delete: {
        tags: [tag],
        summary: `Remove one ${id} from this world`,
        responses: {
          204: { description: 'Removed' },
          404: problem('No such resource in this world'),
        },
      },
    };
    paths[`/v1/worlds/{world}/${id}/{id}/history`] = {
      parameters: [world, identifier],
      get: {
        tags: [tag],
        summary: `Every version of one ${id}, newest first`,
        responses: {
          200: {
            description: 'The versions',
            content: json({ $ref: '#/components/schemas/History' }),
          },
        },
      },
    };
    paths[`/v1/worlds/{world}/${id}/{id}/references`] = {
      parameters: [world, identifier, ...narrowing],
      get: {
        tags: [tag],
        summary: `Everything in the world that refers to one ${id}`,
        responses: {
          200: {
            description: 'The referring resources',
            content: json({ $ref: '#/components/schemas/References' }),
          },
        },
      },
    };
    const generator = GENERATORS[id];
    if (generator) {
      paths[`/v1/${id}/$generate`] = {
        post: {
          tags: [tag],
          summary: `Generate ${id} resources without saving them`,
          description:
            `${generator.description} Needs no world and no account. ` +
            'Returns the resources stamped generated, each carrying its ' +
            'model; post one back, or import them, to keep them. Without ' +
            'an account, a place may be a settlement or a county but not a ' +
            'larger realm. The species, culture and calendar are sent whole.',
          security: [],
          requestBody: body(generator.input),
          responses: {
            200: { description: 'Generated', content: json(bundle) },
            400: problem('The input is not valid'),
          },
        },
      };
      paths[`/v1/worlds/{world}/${id}/$generate`] = {
        parameters: [world],
        post: {
          tags: [tag],
          summary: `Generate ${id} resources from this world's content`,
          description:
            `${generator.description} The species, culture and calendar ` +
            'are named by reference or id and read from the world. Nothing ' +
            'is saved: import what is worth keeping.',
          requestBody: body(generator.input),
          responses: {
            200: { description: 'Generated', content: json(bundle) },
            400: problem('The input is not valid'),
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
        'ontology model. Content belongs to a world, which is the tenant. ' +
        'Every error carries a `code` and the `requestId` of the request.',
    },
    ...(options.url ? { servers: [{ url: options.url }] } : {}),
    tags: [
      { name: 'meta' },
      { name: 'worlds' },
      ...ids.map((id) => ({ name: id })),
    ],
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

type JsonObject = Record<string, unknown>;

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

const ifMatch = {
  name: 'If-Match',
  in: 'header',
  schema: { type: 'string' },
  description:
    'The ETag from the last read, which is the revision in quotes. The ' +
    'write is refused with 412 if the resource has moved on since.',
};

const etag = {
  ETag: {
    schema: { type: 'string' },
    description: 'The revision, in quotes. Send it back as If-Match.',
  },
};

/** The two time axes, which every read accepts. */
const reads = [
  {
    name: 'at',
    in: 'query',
    schema: { type: 'integer' },
    description:
      'In-world time, in years of the world calendar. Returns the state ' +
      'that held then: records whose valid time covers the year, and ' +
      'records with no valid time.',
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
  {
    name: 'cell',
    in: 'query',
    schema: { type: 'string', pattern: '^[0-9a-f]{1,16}$' },
    description:
      'A quadtree cell token. Returns everything at or inside the cell.',
  },
  {
    name: 'ids',
    in: 'query',
    schema: { type: 'string' },
    description: 'Comma-separated ids. Returns only those, up to 500.',
  },
  {
    name: 'sort',
    in: 'query',
    schema: { type: 'string', enum: ['id', 'name', 'updatedAt'] },
    description:
      'Order of the page. A cursor is bound to the sort it came from.',
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 500 },
  },
  {
    name: 'cursor',
    in: 'query',
    schema: { type: 'string' },
    description: 'The `next` of a previous page.',
  },
];

/** How a search or a reference lookup is narrowed. */
const narrowing = [
  {
    name: 'models',
    in: 'query',
    schema: { type: 'string' },
    description: 'Comma-separated model ids to restrict the answer to.',
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 500 },
  },
];

const bundle = { $ref: '#/components/schemas/Bundle' };

const fixedSchemas = {
  Bundle: {
    type: 'object',
    properties: { resources: { type: 'array', items: { type: 'object' } } },
    required: ['resources'],
  },
  ModelInfo: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      generate: {
        type: 'object',
        description:
          'Present when something generates this model: what it makes, and the request body as JSON Schema.',
        properties: {
          description: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['description', 'input'],
      },
    },
    required: ['id', 'name'],
  },
  World: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      visibility: { enum: ['private', 'public'] },
      role: { enum: ['owner', 'editor', 'viewer'] },
      archivedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'visibility'],
  },
  Member: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      role: { enum: ['owner', 'editor', 'viewer'] },
    },
    required: ['subject', 'role'],
  },
  Invitation: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      role: { enum: ['owner', 'editor', 'viewer'] },
      invitedAt: { type: 'string', format: 'date-time' },
    },
    required: ['email', 'role', 'invitedAt'],
  },
  History: {
    type: 'object',
    properties: {
      history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            revision: { type: 'integer' },
            recordedAt: { type: 'string', format: 'date-time' },
            deleted: { type: 'boolean' },
            generatedBy: { type: 'string' },
          },
          required: ['revision', 'recordedAt', 'deleted'],
        },
      },
    },
    required: ['history'],
  },
  References: {
    type: 'object',
    properties: {
      references: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            model: { type: 'string' },
            resource: { type: 'object' },
          },
          required: ['model', 'resource'],
        },
      },
    },
    required: ['references'],
  },
  SearchResults: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            model: { type: 'string' },
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            canonStatus: { type: 'string' },
          },
          required: ['model', 'id', 'name', 'canonStatus'],
        },
      },
    },
    required: ['results'],
  },
  Usage: {
    type: 'object',
    properties: {
      calls: { type: 'integer' },
      inputTokens: { type: 'integer' },
      outputTokens: { type: 'integer' },
      costMicros: { type: 'integer' },
      chargeMicros: { type: 'integer' },
    },
    required: [
      'calls',
      'inputTokens',
      'outputTokens',
      'costMicros',
      'chargeMicros',
    ],
  },
  Problem: {
    type: 'object',
    properties: {
      error: { type: 'string', description: 'What went wrong, for a person.' },
      code: {
        type: 'string',
        description: 'What went wrong, for a program.',
        enum: [
          'validation',
          'no-generator',
          'unauthorized',
          'forbidden',
          'not-found',
          'conflict',
          'stale',
          'internal',
        ],
      },
      requestId: { type: 'string' },
      issues: {},
    },
    required: ['error', 'code', 'requestId'],
  },
};

const roleSchema = { enum: ['owner', 'editor', 'viewer'] };

const fixedPaths = {
  '/health': {
    get: {
      tags: ['meta'],
      summary: 'Whether the API is up and can reach its database',
      security: [],
      responses: {
        200: { description: 'Healthy' },
        503: { description: 'The database is unreachable' },
      },
    },
  },
  '/v1/models': {
    get: {
      tags: ['meta'],
      summary: 'The models this deployment serves',
      description:
        'Each with its name and description as the ontology states them, and what generates it, when something does.',
      security: [],
      responses: {
        200: {
          description: 'The model registry',
          content: json({
            type: 'object',
            properties: {
              models: {
                type: 'array',
                items: { $ref: '#/components/schemas/ModelInfo' },
              },
            },
            required: ['models'],
          }),
        },
      },
    },
  },
  '/v1/vocabularies': {
    get: {
      tags: ['meta'],
      summary: 'Every code list, with display text for each code',
      security: [],
      responses: { 200: { description: 'The vocabularies' } },
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
  '/v1/me': {
    get: {
      tags: ['worlds'],
      summary: 'Who the caller is, and the worlds they may open',
      responses: {
        200: { description: 'The caller and their worlds' },
        401: problem('This request needs an account'),
      },
    },
  },
  '/v1/worlds': {
    get: {
      tags: ['worlds'],
      summary: "The caller's worlds",
      parameters: [
        {
          name: 'archived',
          in: 'query',
          schema: { type: 'boolean' },
          description:
            'List archived worlds instead, which only their owners see.',
        },
      ],
      responses: {
        200: {
          description: 'Worlds the caller belongs to',
          content: json({
            type: 'object',
            properties: {
              worlds: {
                type: 'array',
                items: { $ref: '#/components/schemas/World' },
              },
            },
            required: ['worlds'],
          }),
        },
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
          visibility: { enum: ['private', 'public'] },
        },
        required: ['name'],
      }),
      responses: {
        201: {
          description: 'Created',
          content: json({ $ref: '#/components/schemas/World' }),
        },
        400: problem('The body is not valid'),
      },
    },
  },
  '/v1/worlds/{world}': {
    parameters: [world],
    delete: {
      tags: ['worlds'],
      summary: 'Archive a world. The content stays; it stops being listed.',
      responses: {
        204: { description: 'Archived' },
        403: problem('Only an owner may archive a world'),
      },
    },
  },
  '/v1/worlds/{world}/$restore': {
    parameters: [world],
    post: {
      tags: ['worlds'],
      summary: 'Bring an archived world back',
      responses: {
        204: { description: 'Restored' },
        403: problem('Only an owner may restore a world'),
      },
    },
  },
  '/v1/worlds/{world}/members': {
    parameters: [world],
    get: {
      tags: ['worlds'],
      summary: 'Who belongs to a world, and who has been invited',
      responses: {
        200: {
          description: 'Members and pending invitations',
          content: json({
            type: 'object',
            properties: {
              members: {
                type: 'array',
                items: { $ref: '#/components/schemas/Member' },
              },
              invitations: {
                type: 'array',
                items: { $ref: '#/components/schemas/Invitation' },
              },
            },
            required: ['members', 'invitations'],
          }),
        },
        403: problem('Only an owner may see who belongs'),
      },
    },
    post: {
      tags: ['worlds'],
      summary: 'Admit someone to a world, or change their role',
      description:
        'Name the person by `subject` or by `email`. Someone named by email ' +
        'who has not signed in yet is invited, and becomes a member the first ' +
        'time they do.',
      requestBody: body({
        type: 'object',
        properties: {
          subject: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: roleSchema,
        },
        required: ['role'],
      }),
      responses: {
        204: { description: 'Set' },
        202: { description: 'Invited; the person has not signed in yet' },
        404: problem('No such user'),
        409: problem('A world must keep at least one owner'),
      },
    },
  },
  '/v1/worlds/{world}/members/{subject}': {
    parameters: [
      world,
      {
        name: 'subject',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    delete: {
      tags: ['worlds'],
      summary: 'Remove someone from a world',
      responses: {
        204: { description: 'Removed' },
        404: problem('Not a member'),
        409: problem('A world must keep at least one owner'),
      },
    },
  },
  '/v1/worlds/{world}/usage': {
    parameters: [world],
    get: {
      tags: ['worlds'],
      summary: 'What a world has spent on model calls',
      responses: {
        200: {
          description: 'The totals',
          content: json({ $ref: '#/components/schemas/Usage' }),
        },
        403: problem('Only an owner may see what a world has spent'),
      },
    },
  },
  '/v1/worlds/{world}/$search': {
    parameters: [
      world,
      {
        name: 'q',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Text to look for in names.',
      },
      ...narrowing,
    ],
    get: {
      tags: ['meta'],
      summary: 'Search every model at once by name',
      responses: {
        200: {
          description: 'What matched',
          content: json({ $ref: '#/components/schemas/SearchResults' }),
        },
      },
    },
  },
  '/v1/worlds/{world}/$import': {
    parameters: [world],
    post: {
      tags: ['meta'],
      summary: 'Save many resources in one transaction',
      requestBody: body({
        type: 'object',
        properties: {
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                model: { type: 'string' },
                resource: { type: 'object' },
              },
              required: ['model', 'resource'],
            },
          },
        },
        required: ['resources'],
      }),
      responses: {
        201: { description: 'How many were written' },
        400: problem('An entry is not valid; nothing was written'),
      },
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
      reads[0]!,
    ],
    get: {
      tags: ['meta'],
      summary: 'Export everything in a world',
      responses: { 200: { description: 'The export' } },
    },
  },
};

/**
 * Zod emits a recursive shape with a local `$defs` and `#/$defs/…` pointers.
 * In an OpenAPI document a pointer resolves against the document root, where
 * there is no `$defs`, so each definition is moved into `components.schemas`
 * under a name prefixed by its model and every pointer is rewritten to follow.
 */
function hoistDefinitions(
  id: string,
  schema: JsonObject,
  into: JsonObject,
): JsonObject {
  const { $defs: defs, ...rest } = schema as {
    $defs?: JsonObject;
  } & JsonObject;
  const prefix = '#/$defs/';
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as JsonObject).map(([key, v]) => [
          key,
          key === '$ref' && typeof v === 'string' && v.startsWith(prefix)
            ? `#/components/schemas/${id}_${v.slice(prefix.length)}`
            : rewrite(v),
        ]),
      );
    }
    return value;
  };
  for (const [name, definition] of Object.entries(defs ?? {})) {
    into[`${id}_${name}`] = rewrite(definition);
  }
  return rewrite(rest) as JsonObject;
}

/**
 * The shape a client sends: the stored shape without the fields the server
 * sets. A generated client would otherwise ask for an id, a world and a
 * revision that the caller has no way to supply.
 */
function inputVariant(schema: JsonObject): JsonObject {
  const properties = { ...(schema.properties as JsonObject | undefined) };
  for (const field of readOnlyFields) delete properties[field];
  const required = ((schema.required as string[] | undefined) ?? []).filter(
    (name) => !(readOnlyFields as readonly string[]).includes(name),
  );
  return {
    ...schema,
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(schema.description
      ? {
          description: `${schema.description as string} (As sent by a client.)`,
        }
      : {}),
  };
}

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
          next: {
            type: 'string',
            description: 'Cursor for the next page. Absent on the last.',
          },
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
