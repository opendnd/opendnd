import { relative } from 'path';
import { NodePackageManager, NodeProject } from 'projen/lib/javascript';
import {
  TypeScriptProject,
  TypeScriptProjectOptions,
} from 'projen/lib/typescript';
import {
  ReactTypeScriptProject,
  ReactTypeScriptProjectOptions,
} from 'projen/lib/web';
import { ViteConfig } from './vite-config';
import type { ViteProxyTarget } from './vite-config';
import { VitestConfig } from './vitest-config';
import { versions } from '../versions';

const DEFAULT_OPTIONS: Partial<TypeScriptProjectOptions> = {
  defaultReleaseBranch: 'main',
  packageManager: NodePackageManager.BUN,
  projenVersion: versions.projen,
  typescriptVersion: versions.typescript,
  licensed: false,
  release: false,
  jest: false,
  eslint: true,
  prettier: true,
  sampleCode: false,
  disableTsconfigDev: true,
};

function disableChildInstall(project: NodeProject) {
  if (!project.parent) return;
  project.package.postSynthesize = () => {
    project.logger.debug(
      `Skipping install for ${project.name} (workspace child)`,
    );
  };
}

function applyCommonConfig(project: TypeScriptProject) {
  const prettierConfig = project.tryFindObjectFile('.prettierrc.json');
  prettierConfig?.addOverride('singleQuote', true);

  if (project.tsconfig?.file) {
    project.tsconfig.file.addOverride('compilerOptions.strict', true);
    project.tsconfig.file.addOverride('compilerOptions.esModuleInterop', true);
    project.tsconfig.file.addOverride(
      'compilerOptions.resolveJsonModule',
      true,
    );
    project.tsconfig.file.addOverride('compilerOptions.skipLibCheck', true);
  }

  const eslintConfig = project.tryFindObjectFile('.eslintrc.json');
  if (eslintConfig) {
    const rootPath = relative(project.outdir, '.');
    const rootNodeModules = rootPath
      ? `${rootPath}/node_modules`
      : 'node_modules';
    eslintConfig.addOverride('settings.import/resolver.node.moduleDirectory', [
      'node_modules',
      rootNodeModules,
    ]);
  }

  // Parent-relative imports are banned in specs, where the `src` alias is the
  // point. Inside `src` they are required: the `src/*` alias survives into
  // emitted .d.ts files, where a consuming package resolves it against its own
  // `src` and silently gets `any`, because skipLibCheck hides the error.
  project.eslint?.addOverride({
    files: ['specs/**/*.ts', 'specs/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../**'],
              message:
                'Use the src/* alias instead of parent-relative paths (../) in specs.',
            },
          ],
        },
      ],
    },
  });
}

export interface BunWorkspaceProjectOptions extends Omit<
  TypeScriptProjectOptions,
  'defaultReleaseBranch'
> {
  readonly defaultReleaseBranch?: string;
}

/**
 * TypeScript project for Bun workspace child packages
 */
export class BunWorkspaceProject extends TypeScriptProject {
  constructor(options: BunWorkspaceProjectOptions) {
    super({
      ...DEFAULT_OPTIONS,
      ...options,
      defaultReleaseBranch: options.defaultReleaseBranch ?? 'main',
      deps: [...(options.deps ?? [])],
      devDeps: [...(options.devDeps ?? [])],
    });

    disableChildInstall(this);
    applyCommonConfig(this);
  }
}

export interface BunWorkspaceReactProjectOptions extends Omit<
  ReactTypeScriptProjectOptions,
  'defaultReleaseBranch'
> {
  readonly defaultReleaseBranch?: string;
}

/**
 * React TypeScript project for Bun workspace child packages
 */
export class BunWorkspaceReactProject extends ReactTypeScriptProject {
  constructor(options: BunWorkspaceReactProjectOptions) {
    super({
      ...DEFAULT_OPTIONS,
      ...options,
      defaultReleaseBranch: options.defaultReleaseBranch ?? 'main',
      deps: [...(options.deps ?? [])],
      devDeps: [...(options.devDeps ?? [])],
    });

    disableChildInstall(this);
    applyCommonConfig(this);

    // Ensure .tsx files are included in tsconfig
    if (this.tsconfig?.file) {
      this.tsconfig.file.addOverride('include', [
        'src/**/*.ts',
        'src/**/*.tsx',
        'src',
      ]);
    }

    // Configure ESLint to use local tsconfig
    const eslintConfig = this.tryFindObjectFile('.eslintrc.json');
    if (eslintConfig) {
      eslintConfig.addOverride('parserOptions.tsconfigRootDir', undefined);
    }
  }
}

export interface BunWorkspaceReactViteProjectOptions extends BunWorkspaceReactProjectOptions {
  readonly vitePort?: number;
  readonly viteOutDir?: string;
  readonly testDir?: string;
  readonly sampleName?: string;
  /** Workspace package aliases for Vite resolve.alias */
  readonly workspaceAliases?: Record<string, string>;
  /** Enable Tailwind CSS v4 via @tailwindcss/vite plugin */
  readonly tailwind?: boolean;
  /** Dev server proxy rules (maps path prefix to target config) */
  readonly proxy?: Record<string, ViteProxyTarget>;
  /**
   * Files Vitest runs before every spec file, relative to the project: DOM
   * matchers, polyfills for what jsdom lacks, and the like.
   */
  readonly vitestSetupFiles?: string[];
}

/**
 * React TypeScript project with Vite and Vitest for Bun workspace child packages
 */
export class BunWorkspaceReactViteProject extends BunWorkspaceReactProject {
  constructor(options: BunWorkspaceReactViteProjectOptions) {
    super(options);

    // Ensure specs directory is included in tsconfig for test files
    const testDir = options.testDir ?? 'specs';
    if (this.tsconfig?.file) {
      // '.' rather than undefined, so the emitted layout is `dist/src/...`
      // whatever the include set happens to be, instead of moving whenever it
      // changes. See the note in projenrc/packages.ts.
      this.tsconfig.file.addOverride('compilerOptions.rootDir', '.');
      this.tsconfig.file.addOverride('include', [
        'src/**/*.ts',
        'src/**/*.tsx',
        'src',
        `${testDir}/**/*.ts`,
        `${testDir}/**/*.tsx`,
      ]);
    }

    // Set up Vite
    new ViteConfig(this, {
      port: options.vitePort,
      outDir: options.viteOutDir,
      workspaceAliases: options.workspaceAliases,
      tailwind: options.tailwind,
      proxy: options.proxy,
    });

    // Set up Vitest
    new VitestConfig(this, {
      testDir,
      sampleCode: options.sampleName !== undefined,
      sampleName: options.sampleName,
      workspaceAliases: options.workspaceAliases,
      setupFiles: options.vitestSetupFiles,
    });

    // Update ESLint rule to allow devDependencies for test files in specs directory
    const eslintConfig = this.tryFindObjectFile('.eslintrc.json');
    if (eslintConfig) {
      eslintConfig.addOverride('rules.import/no-extraneous-dependencies', [
        'error',
        {
          devDependencies: [
            '**/src/**/*.test.tsx',
            '**/src/setupTests.ts',
            `**/${testDir}/**/*.spec.tsx`,
            `**/${testDir}/**/*.tsx`,
            `**/${testDir}/**/*.ts`,
            '**/*.spec.tsx',
            '**/*.spec.ts',
          ],
          optionalDependencies: false,
          peerDependencies: true,
        },
      ]);
    }
  }
}
