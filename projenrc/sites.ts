import { BunWorkspaceReactViteProject, versions } from '@opendnd/projen';
import { Project } from 'projen';
import type { TypeScriptProject } from 'projen/lib/typescript';
import { describeInReadme } from './packages';

export interface SiteConfig {
  readonly name: string;
  readonly description: string;
  /** Port the Vite development server listens on. */
  readonly port: number;
  readonly deps?: string[];
  readonly devDeps?: string[];
}

/**
 * Web front ends, under sites/. One application: the map, the wiki, characters
 * and campaigns are features of it rather than separate sites.
 */
const sites: readonly SiteConfig[] = [
  {
    name: '@opendnd/app',
    description:
      'The application: sign in, open a world, and read or author any resource through pages built from the ontology the API describes. The map, the wiki, characters and campaigns are features of it.',
    port: 4100,
    deps: [
      `react-router@${versions['react-router']}`,
      // shadcn/ui: its CLI copies components into src/components/ui, which
      // import these. `bunx shadcn add <component>` in the site adds more.
      `shadcn@${versions.shadcn}`,
      `@base-ui/react@${versions['@base-ui/react']}`,
      `class-variance-authority@${versions['class-variance-authority']}`,
      `cn@${versions.cn}`,
      `lucide-react@${versions['lucide-react']}`,
      `tw-animate-css@${versions['tw-animate-css']}`,
      `@fontsource-variable/geist@${versions['@fontsource-variable/geist']}`,
    ],
  },
];

/** What `bunx shadcn add` writes, relative to a site. */
export const SHADCN_OUTPUT = [
  'src/components/ui/**',
  'src/hooks/use-mobile.ts',
  'src/lib/utils.ts',
] as const;

export function configureSites(
  parent: Project,
): BunWorkspaceReactViteProject[] {
  return sites.map((config) => configureOne(parent, config));
}

/**
 * The root's formatter check runs over the whole repository with the root's
 * own ignore list, so the component library's files are excused there too.
 */
export function ignoreSiteGeneratedCode(root: TypeScriptProject): void {
  for (const pattern of SHADCN_OUTPUT) {
    root.prettier?.addIgnorePattern(`sites/**/${pattern}`);
  }
}

/**
 * The `@/` import alias for the sites, added after the root has written the
 * workspace-wide path mappings, which would otherwise replace it.
 *
 * A site bundles rather than emitting declarations, so an alias inside its
 * `src` cannot leak into another package the way it can from a library. The
 * component library's generator writes imports with this alias, so keeping
 * it means its files arrive as written.
 */
export function aliasSites(projects: readonly BunWorkspaceReactViteProject[]) {
  for (const project of projects) {
    project.tsconfig?.file.addOverride('compilerOptions.paths.@/*', [
      './src/*',
    ]);
  }
}

function configureOne(
  parent: Project,
  config: SiteConfig,
): BunWorkspaceReactViteProject {
  const project = new BunWorkspaceReactViteProject({
    name: config.name,
    description: config.description,
    outdir: `sites/${config.name}`,
    parent,
    vitePort: config.port,
    tailwind: true,
    // DOM matchers and the polyfills jsdom needs for the component library.
    vitestSetupFiles: ['./specs/setup.ts'],
    deps: [
      `react@${versions.react}`,
      `react-dom@${versions['react-dom']}`,
      ...(config.deps ?? []),
    ],
    devDeps: [
      `@types/react@${versions['@types/react']}`,
      `@types/react-dom@${versions['@types/react-dom']}`,
      `vite@${versions.vite}`,
      `@vitejs/plugin-react@${versions['@vitejs/plugin-react']}`,
      `tailwindcss@${versions.tailwindcss}`,
      `@tailwindcss/vite@${versions['@tailwindcss/vite']}`,
      `jsdom@${versions.jsdom}`,
      `@testing-library/react@${versions['@testing-library/react']}`,
      `@testing-library/jest-dom@${versions['@testing-library/jest-dom']}`,
      `@testing-library/user-event@${versions['@testing-library/user-event']}`,
      ...(config.devDeps ?? []),
    ],
  });

  /*
   * The React project type assumes Create React App. Vite replaces it here,
   * so the CRA tooling is removed rather than installed and left idle, and
   * the versions it adds unpinned are pinned again from versions.ts.
   */
  project.deps.removeDependency('react-scripts');
  project.deps.removeDependency('web-vitals');
  project.package.file.addDeletionOverride('eslintConfig');
  project.package.file.addDeletionOverride('browserslist');
  project.addDeps(
    `react@${versions.react}`,
    `react-dom@${versions['react-dom']}`,
  );
  project.addDevDeps(
    `@types/react@${versions['@types/react']}`,
    `@types/react-dom@${versions['@types/react-dom']}`,
    `jsdom@${versions.jsdom}`,
    `@testing-library/react@${versions['@testing-library/react']}`,
    `@testing-library/dom@${versions['@testing-library/dom']}`,
    `@testing-library/jest-dom@${versions['@testing-library/jest-dom']}`,
    `@testing-library/user-event@${versions['@testing-library/user-event']}`,
  );

  // The projen tasks say what the scripts say, so neither runs CRA.
  project.tasks.tryFind('dev')?.reset('bunx vite');
  project.testTask.reset('bunx vitest run --passWithNoTests specs');
  project.tasks.tryFind('test:watch')?.reset('bunx vitest specs');

  /*
   * Build type-checks before bundling. Vite strips types without checking
   * them, so without the compile step a type error would ship.
   */
  project.addScripts({ build: 'bunx projen compile && bunx vite build' });

  if (project.tsconfig?.file) {
    // Vite emits; tsc only checks. Declarations cannot be asked for with noEmit.
    project.tsconfig.file.addOverride('compilerOptions.declaration', false);
    project.tsconfig.file.addOverride('compilerOptions.types', ['vite/client']);
  }

  project.gitignore.addPatterns('.env.local');

  /*
   * Files the component library's CLI writes are generated code in the
   * repository's sense: kept as written, so `bunx shadcn add` can update
   * them, and checked by the compiler rather than by the linters.
   */
  for (const pattern of SHADCN_OUTPUT) {
    project.eslint?.addIgnorePattern(pattern);
    project.prettier?.addIgnorePattern(pattern);
  }

  describeInReadme(project, config.name, config.description);

  return project;
}
