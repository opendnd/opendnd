import { BunTestConfig, BunWorkspaceProject, versions } from '@opendnd/projen';
import { JsonFile, Project, TextFile } from 'projen';
import { TypeScriptProject } from 'projen/lib/typescript';

export interface PackageConfig {
  readonly name: string;
  readonly description: string;
  readonly deps?: string[];
  readonly devDeps?: string[];
  /** Bun test timeout in ms. Raised for tests that synthesize whole projects. */
  readonly testTimeout?: number;
  /** Command run before this package's tests, for anything they need running. */
  readonly beforeTest?: string;
  /** Entry point of a CDK app, which also gets a cdk.json. */
  readonly cdkApp?: string;
  /** Extra projen tasks: name -> { description, exec }. */
  readonly tasks?: Record<string, { description: string; exec: string }>;
  /** Globs of generated source that eslint and prettier must leave alone. */
  readonly generated?: string[];
}

const packages: readonly PackageConfig[] = [
  {
    name: '@opendnd/projen',
    description:
      'Projen components for the OpenDnD monorepo (Bun workspaces, Turborepo, docs site).',
    deps: [
      `projen@${versions.projen}`,
      `dotenv-mono@${versions['dotenv-mono']}`,
    ],
    testTimeout: 30000,
  },
  {
    name: '@opendnd/ours',
    description:
      'Tooling for the OURS ontology format: resource types, bundle loader, validator and JSON Schema to Zod code generation. Domain-agnostic.',
    deps: [`zod@${versions.zod}`],
  },
  {
    name: '@opendnd/ontology',
    description:
      'The OpenDnD worldbuilding ontology authored in OURS: models, JSON Schemas, vocabularies and alignment mappings.',
    devDeps: ['@opendnd/ours@workspace:*', `ajv@${versions.ajv}`],
    tasks: {
      generate: {
        description:
          'Publish the OURS bundle and the reference pages built from it into the docs site.',
        exec: 'bun run scripts/publish.ts',
      },
    },
  },
  {
    name: '@opendnd/llm',
    description:
      'One interface to language models: providers for Ollama, Bedrock and any OpenAI-compatible or Anthropic endpoint, named tasks whose model comes from configuration or the call, a content-addressed cache, Zod-validated structured output and per-call cost accounting. Domain-agnostic.',
    deps: [`zod@${versions.zod}`],
  },
  {
    name: '@opendnd/random',
    description:
      'Seeded, deterministic randomness: a xoshiro128** PRNG keyed by a seed string, dice notation, weighted picks, and UUID v5 derived ids.',
  },
  {
    name: '@opendnd/spatial',
    description:
      'Spatial identity for worlds: a cube-sphere quadtree with S2-compatible cell ids from planet to 5-foot square, projection for any world radius, containment, neighbours and battle-map tiles.',
    devDeps: ['@opendnd/random@workspace:*'],
  },
  {
    name: '@opendnd/generators',
    description:
      'Content generators behind two contracts: Generator, which is deterministic and synchronous (names, genetics, people, settlements, realms), and Author, which is asynchronous and calls a language model through @opendnd/llm. Both stamp their output with provenance.',
    deps: [
      '@opendnd/llm@workspace:*',
      '@opendnd/random@workspace:*',
      '@opendnd/types@workspace:*',
    ],
  },
  {
    name: '@opendnd/simulation',
    description:
      'History simulation: a yearly clock over a world state and rule systems (demographics, lineage, succession) that emit Event, Relationship, Person, Tenure and Population resources, fitted around authored canon, plus a consistency checker.',
    deps: [
      '@opendnd/random@workspace:*',
      '@opendnd/types@workspace:*',
      '@opendnd/generators@workspace:*',
    ],
  },
  {
    name: '@opendnd/types',
    description:
      'TypeScript types and Zod schemas generated from the @opendnd/ontology OURS bundle. Do not edit by hand; run `bun run generate`.',
    deps: [`zod@${versions.zod}`],
    devDeps: ['@opendnd/ours@workspace:*', '@opendnd/ontology@workspace:*'],
    generated: ['src/generated/**'],
    tasks: {
      generate: {
        description:
          'Regenerate src/generated from the OURS bundle in @opendnd/ontology. Run `bun run generate` at the root so dependencies build first.',
        exec: 'bun run scripts/generate.ts',
      },
    },
  },
];

/** Deployables, under apps/. Same conventions as a package, different folder. */
const apps: readonly PackageConfig[] = [
  {
    name: '@opendnd/api',
    description:
      'The headless API: one route set per ontology model, generated from the model registry, over a multi-tenant Postgres store in which a world is the tenant and content is layered from the world and the modules it enables.',
    deps: [
      `hono@${versions.hono}`,
      `drizzle-orm@${versions['drizzle-orm']}`,
      `pg@${versions.pg}`,
      `zod@${versions.zod}`,
      '@opendnd/types@workspace:*',
      '@opendnd/generators@workspace:*',
      '@opendnd/simulation@workspace:*',
      '@opendnd/llm@workspace:*',
      `@aws-sdk/client-eventbridge@${versions['@aws-sdk/client-eventbridge']}`,
      `@aws-sdk/client-secrets-manager@${versions['@aws-sdk/client-secrets-manager']}`,
    ],
    devDeps: [
      `drizzle-kit@${versions['drizzle-kit']}`,
      `@types/pg@${versions['@types/pg']}`,
    ],
    // The API cannot be tested without a database, so its test task provides
    // the one the repository ships. Already running is a no-op.
    beforeTest:
      'docker compose --file ../../../docker-compose.yml up --detach --wait postgres',
    tasks: {
      dev: {
        description:
          'Run the API against the local Postgres from docker-compose, with development sign-in on.',
        // This task exists for local work and nothing else runs it, so the
        // development resolver is asked for here explicitly. A deployment
        // never sets the variable and stays anonymous-only without a pool.
        exec: 'OPENDND_DEV_AUTH=on bun run --hot src/server.ts',
      },
      migrate: {
        description: 'Apply the SQL migrations in migrations/ to DATABASE_URL.',
        exec: 'bun run scripts/migrate.ts',
      },
      generate: {
        description: 'Write the OpenAPI description into the docs site.',
        exec: 'bun run scripts/openapi.ts',
      },
    },
  },
  {
    name: '@opendnd/infra',
    description:
      'The AWS deployment as CDK: the API on Lambda behind an HTTP API, a Cognito user pool, the outbox drained onto an EventBridge bus, and a bucket for tiles and assets. No VPC, because the database is reached over TLS.',
    deps: [
      `aws-cdk-lib@${versions['aws-cdk-lib']}`,
      `constructs@${versions.constructs}`,
      '@opendnd/api@workspace:*',
    ],
    devDeps: [`aws-cdk@${versions['aws-cdk']}`, `esbuild@${versions.esbuild}`],
    cdkApp: 'src/main.ts',
    testTimeout: 60000,
    tasks: {
      synth: {
        description: 'Synthesize the CloudFormation templates into cdk.out.',
        exec: 'cdk synth',
      },
      diff: {
        description: 'Show what a deployment would change.',
        exec: 'cdk diff',
      },
      deploy: {
        description: 'Deploy every stack. Needs AWS credentials.',
        exec: 'cdk deploy --all',
      },
    },
  },
];

export function configurePackages(parent: Project): TypeScriptProject[] {
  return [
    ...packages.map((config) => configureOne(parent, config, 'packages')),
    ...apps.map((config) => configureOne(parent, config, 'apps')),
  ];
}

function configureOne(
  parent: Project,
  config: PackageConfig,
  folder: 'packages' | 'apps',
): TypeScriptProject {
  {
    const project = new BunWorkspaceProject({
      name: config.name,
      description: config.description,
      outdir: `${folder}/${config.name}`,
      parent,
      deps: config.deps ?? [],
      devDeps: config.devDeps ?? [],
      tsconfig: {
        compilerOptions: {
          outDir: 'dist',
          rootDir: '.',
          declaration: true,
          skipLibCheck: true,
        },
      },
    });

    new BunTestConfig(project, {
      sampleCode: false,
      ...(config.testTimeout ? { timeout: config.testTimeout } : {}),
      ...(config.beforeTest ? { before: config.beforeTest } : {}),
    });

    for (const [name, task] of Object.entries(config.tasks ?? {})) {
      project.addTask(name, task);
    }

    // Generated code is checked by the drift test and the compiler, not by
    // formatters, which would otherwise rewrite it and cause drift.
    for (const glob of config.generated ?? []) {
      project.eslint?.addIgnorePattern(glob);
      project.prettier?.addIgnorePattern(glob);
    }

    // Scratch space used by tests that need to import a generated module.
    project.gitignore.addPatterns('specs/.tmp-*');

    if (config.cdkApp) {
      new JsonFile(project, 'cdk.json', {
        marker: false,
        obj: {
          app: `bun run ${config.cdkApp}`,
          output: 'cdk.out',
          watch: { include: ['src/**'] },
          context: {
            /*
             * Stated rather than defaulted. Strong references stop a stack
             * removing an export another stack still consumes, which is the
             * behaviour worth having between the persistent stack and the
             * service that reads from it.
             */
            '@aws-cdk/core:defaultCrossStackReferences': 'strong',
          },
        },
      });
      project.gitignore.addPatterns('cdk.out', '.cdk.staging');
    }

    describeInReadme(project, config.name, config.description);

    project.package.addField('main', 'dist/src/index.js');
    project.package.addField('types', 'dist/src/index.d.ts');

    return project;
  }
}

/**
 * A README generated from the description in this file, so the one npm shows
 * is the one already stated here and cannot drift from it. The full
 * documentation is a page on the docs site, which the README points at.
 */
export function describeInReadme(
  project: Project,
  name: string,
  description: string,
): void {
  const slug = name.replace('@opendnd/', '');
  new TextFile(project, 'README.md', {
    marker: false,
    lines: [
      `# ${name}`,
      '',
      description,
      '',
      `Part of [OpenDnD](https://github.com/opendnd/opendnd), an open ontology, headless API and toolset for building fictional worlds. A project of [OpenHI](https://openhi.org).`,
      '',
      `Documentation: https://docs.opendnd.org/packages/${slug}/`,
      '',
      'Code is MIT. See `CONTENT-LICENSE.md` in the repository root for the',
      'licence covering game content.',
      '',
    ],
  });
}
