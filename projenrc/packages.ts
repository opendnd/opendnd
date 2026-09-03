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
    name: '@opendnd/ontology',
    description:
      'The OpenDnD worldbuilding ontology authored in OURS: models, JSON Schemas, vocabularies and alignment mappings.',
    deps: [`zod@${versions.zod}`],
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

    project.package.addField('main', 'dist/src/index.js');
    project.package.addField('types', 'dist/src/index.d.ts');

    return project;
  });
}
