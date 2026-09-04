import { relative } from 'path';
import { JsonFile, Project, TextFile, TomlFile } from 'projen';
import { NodePackageManager } from 'projen/lib/javascript';
import {
  TypeScriptProject,
  TypeScriptProjectOptions,
} from 'projen/lib/typescript';
import { AgentDocsConfig } from './agent-docs-config';
import { versions } from '../versions';

/**
 * Options for the root Bun monorepo project
 */
export interface BunMonorepoProjectOptions extends Omit<
  TypeScriptProjectOptions,
  'defaultReleaseBranch'
> {
  readonly defaultReleaseBranch?: string;
  /**
   * Workspace patterns for the monorepo (e.g., ['packages/@opendnd/*', 'services/*', 'sites/*'])
   */
  readonly workspaces?: string[];
  /**
   * Scopes for packages
   */
  readonly scopes?: string[];
  /**
   * Workspace patterns to exclude from dev scripts (e.g., ['!./packages/**'])
   */
  readonly devExcludeWorkspaces?: string[];
  readonly turbo?: boolean;
  readonly env?: string[];
}

/**
 * Root project for a Bun-based monorepo with Turborepo integration
 */
export class BunMonorepoProject extends TypeScriptProject {
  private readonly workspaces: string[];
  private readonly scopes?: string[];
  private readonly devExcludeWorkspaces: string[];

  constructor(options: BunMonorepoProjectOptions) {
    const defaultOptions: Partial<TypeScriptProjectOptions> = {
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
      depsUpgrade: false,
      buildWorkflow: true,
      pullRequestTemplate: true,
      // No `bun` devDependency.
      //
      // Installing bun into node_modules put a second binary on PATH, so which
      // one ran a script depended on PATH ordering at the moment it was invoked.
      // CI's setup-bun action pins no version either, so a single test run could
      // use a different runner from the one the developer used, and this
      // repository saw three versions across one session. Two test runners with
      // different internals is enough on its own to produce intermittent
      // timeouts, and it makes local and CI results incomparable.
      //
      // `packageManager` below still names bun, which is what turborepo checks.
      // It declares the manager rather than installing one, so it creates no
      // second binary.
      devDeps: [`typescript@${versions.typescript}`],
      gitignore: [
        ...(options.gitignore ?? []),
        '.DS_Store',
        'node_modules',
        'dist',
        '.projen',
        '!/.projen',
        '/.projen/*',
        '!/.projen/tasks.json',
        '!/.projen/deps.json',
        '!/.projen/files.json',
        '.turbo',
        '.env',
        '.env.local',
        '.env.*.local',
      ],
      tsconfig: {
        compilerOptions: {
          rootDir: undefined,
          outDir: 'lib',
          declaration: true,
          strict: true,
          esModuleInterop: true,
          resolveJsonModule: true,
        },
        include: ['.projenrc.ts', 'projenrc/**/*.ts'],
        exclude: ['node_modules'],
      },
    };

    super({
      ...defaultOptions,
      ...options,
      defaultReleaseBranch: options.defaultReleaseBranch ?? 'main',
      devDeps: [...(defaultOptions.devDeps ?? []), ...(options.devDeps ?? [])],
      gitignore: [
        ...(defaultOptions.gitignore ?? []),
        ...(options.gitignore ?? []),
      ],
    });

    // Store workspace configuration
    this.workspaces = options.workspaces ?? [];
    this.scopes = options.scopes;
    this.devExcludeWorkspaces = options.devExcludeWorkspaces ?? [];

    if (this.buildTask) {
      this.tasks.removeTask('build');
      this.addTask('build', {
        exec: 'bun run build:all',
        description: 'Build all packages and services using Turborepo',
      });
    }

    this.configurePrettier();
    this.configureEslint();
    this.configureBunWorkspaces();
    this.configureBunScripts();
    this.configureDefaultTask();
    this.configureBuildWorkflow();
    this.configureEnvFiles(options.env);
    this.configureGitAttributes();
    new AgentDocsConfig(this);

    if (options.turbo !== false) {
      this.addDevDeps(`turbo@${versions.turbo}`);
      this.configureBunTest();
      this.configureTurborepo();
    }

    // Configure gitattributes after all other setup
    // This must run after parent constructor which sets up gitattributes
    this.configureGitAttributes();
  }

  private configurePrettier() {
    if (!this.prettier) return;
    const config = this.tryFindObjectFile('.prettierrc.json');
    config?.addOverride('singleQuote', true);
    // Projen marks generated configs read-only; skip them in prettier:fix.
    this.prettier.addIgnorePattern('**/vite.config.ts');
    this.prettier.addIgnorePattern('**/vitest.config.ts');
    // Match common build/output dirs from .gitignore (prettier no longer uses it).
    for (const pattern of [
      'node_modules',
      'dist',
      '/lib',
      'coverage',
      '.turbo',
      'build',
      '*.generated.ts',
      '**/src/generated/**',
      // Astro writes its content collection and env types here on every build,
      // and they are not formatted to this project's rules. They are gitignored,
      // so they only exist locally and in CI after a build has run, which is
      // exactly when prettier:check would trip over them.
      '**/.astro',
    ]) {
      this.prettier.addIgnorePattern(pattern);
    }
  }

  private configureEslint() {
    if (!this.eslint) return;

    this.eslint.addOverride({
      files: ['.projenrc.ts', 'projenrc/**/*.ts'],
      rules: { 'import/no-extraneous-dependencies': 'off' },
    });

    // Root ESLint lints projenrc only; workspace trees are ignored via patterns below.
    const config = this.tryFindObjectFile('.eslintrc.json');
    const ignorePatterns = [
      '*.js',
      '*.d.ts',
      'node_modules/',
      '*.generated.ts',
      'coverage',
      '!.projenrc.js',
    ];

    // Add workspace patterns to ignore
    if (this.workspaces.length > 0) {
      ignorePatterns.push(...this.workspaces);
    }

    config?.addOverride('ignorePatterns', ignorePatterns);
  }

  private configureBunWorkspaces() {
    const pkg = this.tryFindObjectFile('package.json');
    if (this.workspaces.length > 0) {
      pkg?.addOverride('workspaces', this.workspaces);
    }
    pkg?.addOverride('packageManager', `bun@${versions.bun}`);

    // Configure TypeScript path mappings for root project if scopes are provided
    if (this.scopes && this.tsconfig?.file) {
      this.tsconfig.file.addOverride('compilerOptions.baseUrl', '.');
      const paths = this.scopes.reduce(
        (acc, scope) => {
          acc[`${scope}/*`] = [`packages/${scope}/*/src`];
          return acc;
        },
        {} as Record<string, string[]>,
      );
      this.tsconfig.file.addOverride('compilerOptions.paths', paths);
    }
  }

  private configureBunScripts() {
    this.addScripts({
      projen: 'bunx projen',
      compile: 'bunx projen compile',
      default: 'bunx projen default',
      eject: 'bunx projen eject',
      package: 'bunx projen package',
      'post-compile': 'bunx projen post-compile',
      'post-upgrade': 'bunx projen post-upgrade',
      'pre-compile': 'bunx projen pre-compile',
      test: 'bunx projen test',
      'test:watch': 'bunx projen test:watch',
      upgrade: 'bunx projen upgrade',
      clobber: 'bunx projen clobber',
      eslint: 'bunx projen eslint',
      watch: 'bunx projen watch',
      'build:all': 'turbo run build',
      generate: 'turbo run generate',
      'test:all': 'turbo run test',
      // What CI runs. Same tests, plus a JUnit report per package so an
      // intermittent failure leaves evidence instead of one line of console.
      'test:ci': 'turbo run test:ci',
      'lint:all': 'turbo run lint',
      'prettier:check':
        'prettier --check "**/*.{ts,tsx,js,jsx}" --ignore-path .prettierignore',
      'prettier:fix':
        'prettier --write "**/*.{ts,tsx,js,jsx}" --ignore-path .prettierignore',
    });

    const pkg = this.tryFindObjectFile('package.json');
    pkg?.addOverride('scripts.build', 'bunx projen build');
    pkg?.addOverride('scripts.eslint', 'bunx projen eslint');
    pkg?.addOverride('scripts.test', 'bunx projen test');
    pkg?.addOverride('scripts.watch', 'bunx projen watch');
  }

  private configureDefaultTask() {
    this.defaultTask?.reset('bun run .projenrc.ts');
    this.testTask?.reset(
      'bun run lint:all && bun run prettier:check && bun run test:ci',
    );
    this.addTask('prettier:fix', {
      exec: 'bun run prettier:fix',
      description: 'Format all files with Prettier',
    });
    this.addTask('dev', {
      exec: 'bun run dev:all',
      description: 'Start all services and sites in development mode',
    });
  }

  private configureBuildWorkflow() {
    const buildWorkflow = this.tryFindObjectFile('.github/workflows/build.yml');
    if (buildWorkflow) {
      buildWorkflow.addOverride('jobs.build.outputs', undefined);
      buildWorkflow.addOverride('jobs.build.steps', [
        { name: 'Checkout', uses: 'actions/checkout@v4' },
        { name: 'Setup bun', uses: 'oven-sh/setup-bun@v1' },
        {
          name: 'Restore Turbo cache',
          uses: 'actions/cache@v4',
          with: {
            path: '.turbo',
            key: "${{ runner.os }}-turbo-${{ hashFiles('bun.lock') }}-${{ hashFiles('turbo.json') }}",
          },
        },
        { name: 'Install dependencies', run: 'bun install' },
        {
          name: 'Synthesize project',
          run: 'bun run .projenrc.ts',
        },
        { name: 'Build', run: 'bunx projen build' },
        { name: 'Test', run: 'bunx projen test' },
        {
          // `if: always()` so it runs on failure, which is the only time it
          // matters. Without this the reports exist inside the runner and are
          // thrown away with it, which is how an intermittent failure stays a
          // single unexplained line.
          name: 'Upload test reports',
          uses: 'actions/upload-artifact@v4',
          if: 'always()',
          with: {
            name: 'test-results',
            path: '**/test-results.xml',
            'if-no-files-found': 'ignore',
            'retention-days': 14,
          },
        },
        {
          name: 'Save Turbo cache',
          uses: 'actions/cache@v4',
          if: 'always()',
          with: {
            path: '.turbo',
            key: "${{ runner.os }}-turbo-${{ hashFiles('bun.lock') }}-${{ hashFiles('turbo.json') }}",
          },
        },
      ]);
      buildWorkflow.addOverride('jobs.self-mutation', undefined);
    }

    const prLintWorkflow = this.tryFindObjectFile(
      '.github/workflows/pull-request-lint.yml',
    );
    if (prLintWorkflow) {
      prLintWorkflow.addOverride('on.pull_request_target', undefined);
      prLintWorkflow.addOverride('on.pull_request', {
        types: [
          'opened',
          'edited',
          'synchronize',
          'reopened',
          'ready_for_review',
        ],
      });
    }
  }

  private configureEnvFiles(env?: string[]) {
    const envContents = env?.map((e) => `# ${e}`);
    const lines = envContents ?? [];
    lines.push(''); // add newline
    new TextFile(this, '.env.example', { lines });
  }

  /**
   * Keep a bare `bun test` at the root honest.
   *
   * Front ends under `sites` test with vitest under jsdom, and their specs
   * cannot run under `bun test` at all: they fail on `document is not
   * defined`, which reads as a broken repository rather than as the wrong
   * runner. The supported command is `bunx projen test`, but `bun test` is
   * what people type, so it should either work or not collect files it cannot
   * run.
   *
   * Everything else, packages and services alike, does use `bun test` and
   * stays included.
   */
  private configureBunTest() {
    new TomlFile(this, 'bunfig.toml', {
      marker: true,
      obj: {
        test: {
          pathIgnorePatterns: ['**/sites/**', '**/docs/**', '**/dist/**'],
        },
      },
    });
  }

  private configureTurborepo() {
    new JsonFile(this, 'turbo.json', {
      marker: true,
      obj: {
        globalEnv: ['BRANCH_NAME'],
        ui: 'stream',
        dangerouslyDisablePackageManagerCheck: false,
        cacheDir: '.turbo/cache',
        envMode: 'strict',
        concurrency: '20',
        tasks: {
          'turbo:build': {
            dependsOn: ['^turbo:build'],
            env: [],
            passThroughEnv: [],
            outputs: [],
            cache: true,
            inputs: ['.projen/**', '!.DS_Store', '!**/.DS_Store'],
            outputLogs: 'new-only',
            persistent: false,
            interactive: false,
          },
          build: {
            dependsOn: ['^build'],
            outputs: ['dist/**', '.next/**', '!.next/cache/**'],
            cache: true,
          },
          test: { dependsOn: ['^build'], cache: true },
          // The same tests with a JUnit report alongside. Declaring the report
          // as an output means turbo restores it on a cache hit, so the evidence
          // survives a cached run rather than only existing when tests re-run.
          'test:ci': {
            dependsOn: ['^build'],
            cache: true,
            outputs: ['test-results.xml'],
          },
          generate: { dependsOn: ['^build'], cache: false },
          lint: { cache: true },
          dev: {
            persistent: true,
            cache: false,
            inputs: ['.env', '.env.local'],
          },
        },
      },
    });
  }

  /**
   * Builds TypeScript path mappings and ESLint resolver config for all subprojects
   */
  public buildWorkspacePaths(): void {
    if (!this.scopes || this.scopes.length === 0) return;

    const root = this.root as Project;

    root.subprojects.forEach((subproject) => {
      if (!(subproject instanceof TypeScriptProject)) return;
      if (!subproject.tsconfig?.file) return;

      // Full type check on every compile, not an incremental one.
      //
      // projen defaults `compile` to `tsc --build`, which keeps state in
      // dist/tsconfig.tsbuildinfo. These tsconfigs declare no project
      // `references` (cross-package resolution goes through bun workspace
      // symlinks in node_modules), so tsc cannot see that a dependency's
      // emitted .d.ts changed. Editing package A therefore leaves package B's
      // buildinfo looking current: `tsc --build` prints "up to date", exits 0,
      // and turbo reports the build green while B is genuinely broken. That is
      // not a cache miss turbo can fix, because the task does run; it declines
      // to do work.
      //
      // Plain `tsc` writes no buildinfo (neither `incremental` nor `composite`
      // is set), so it always checks. Per-package caching still comes from
      // turbo, which does track dependency outputs.
      subproject.compileTask.reset('tsc');

      // Specs are typechecked, not emitted.
      //
      // They used to be in the build tsconfig's `include`, which meant `tsc`
      // compiled them straight into `dist` alongside src. That put 125 stale
      // `.spec.js` files in the repository's output directories, and a bare
      // `bun test` at the root collected them: the same specs twice, one copy
      // compiled against whatever the source looked like when it was last
      // built. Failures from those copies made the whole suite look broken.
      //
      // A separate config with `noEmit` keeps the typechecking, which is the
      // part that was worth having.
      subproject.compileTask.exec('tsc -p tsconfig.spec.json');

      new JsonFile(subproject, 'tsconfig.spec.json', {
        obj: {
          extends: './tsconfig.json',
          compilerOptions: { noEmit: true },
          include: [
            'src/**/*.ts',
            'src/**/*.tsx',
            'specs/**/*.ts',
            'specs/**/*.tsx',
          ],
        },
      });

      // Set up src/* and specs/* path aliases for absolute-style imports
      // Cross-package @opendnd/* resolution uses bun workspace symlinks
      // (via node_modules) so tsc compiles each package with its own tsconfig
      subproject.tsconfig.file.addOverride('compilerOptions.baseUrl', '.');
      const paths: Record<string, string[]> = {
        src: ['./src/index.ts'],
        'src/*': ['./src/*'],
        'specs/*': ['./specs/*'],
      };
      subproject.tsconfig.file.addOverride('compilerOptions.paths', paths);

      if (subproject.eslint) {
        const eslintConfig = subproject.tryFindObjectFile('.eslintrc.json');
        if (eslintConfig) {
          const rootPath = relative(subproject.outdir, '.');
          const rootNodeModules = rootPath
            ? `${rootPath}/node_modules`
            : 'node_modules';

          eslintConfig.addOverride(
            'settings.import/resolver.node.moduleDirectory',
            ['node_modules', rootNodeModules],
          );
        }
      }
    });
  }

  /**
   * Configures dev scripts to run all services and sites concurrently
   */
  public configureDevScripts(): void {
    const pkg = this.tryFindObjectFile('package.json');
    if (this.devExcludeWorkspaces.length > 0) {
      const filter = this.devExcludeWorkspaces
        .map((pattern) => `--filter='${pattern}'`)
        .join(' ');
      pkg?.addOverride('scripts.dev:all', `turbo run dev ${filter}`);
      pkg?.addOverride('scripts.dev', `turbo run dev ${filter}`);
    } else {
      pkg?.addOverride('scripts.dev:all', 'turbo run dev');
      pkg?.addOverride('scripts.dev', 'turbo run dev');
    }
  }

  /**
   * Override gitattributes
   */
  private configureGitAttributes(): void {
    // Projen's TypeScriptProject defaults to bun.lockb, but this project uses bun.lock
    // Add bun.lock pattern (bun.lockb will also be present from projen default, which is fine)
    if (this.gitattributes) {
      this.gitattributes.addAttributes('/bun.lock', 'linguist-generated');
    }
  }
}
