import { BunTestConfig, BunWorkspaceProject, versions } from '@opendnd/projen';
import { Project } from 'projen';
import { TypeScriptProject } from 'projen/lib/typescript';

export interface PackageConfig {
  readonly name: string;
  readonly description: string;
  readonly deps?: string[];
  readonly devDeps?: string[];
  /** Bun test timeout in ms. Projen synth tests need more than the default. */
  readonly testTimeout?: number;
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
    devDeps: ['@opendnd/ours@workspace:*'],
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
      'Deterministic content generators (names, genetics, people) behind one Generator contract: input resources plus a seed path in, ontology resources with provenance out.',
    deps: ['@opendnd/random@workspace:*', '@opendnd/types@workspace:*'],
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

export function configurePackages(parent: Project): TypeScriptProject[] {
  return packages.map((config) => {
    const project = new BunWorkspaceProject({
      name: config.name,
      description: config.description,
      outdir: `packages/${config.name}`,
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

    project.package.addField('main', 'dist/src/index.js');
    project.package.addField('types', 'dist/src/index.d.ts');

    return project;
  });
}
