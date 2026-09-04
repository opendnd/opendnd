import { Component, FileBase, SampleFile } from 'projen';
import { ReactTypeScriptProject } from 'projen/lib/web';
import { synthesizePackagePathsPluginSource } from './vite-package-paths-plugin';
import { versions } from '../versions';

export interface VitestConfigOptions {
  readonly watch?: boolean;
  readonly environment?: string;
  readonly globals?: boolean;
  readonly setupFiles?: string[];
  readonly plugins?: string[];
  readonly testDir?: string;
  readonly sampleCode?: boolean;
  readonly sampleName?: string;
  /**
   * Workspace package aliases, matching the app's Vite config.
   *
   * Without them a spec that reaches a workspace package gets that package's
   * `dist` build, whose compiled `src/*` requires resolve against the wrong
   * root and throw at import time. The app config has always had these; the
   * test config did not, which made those packages untestable from here.
   */
  readonly workspaceAliases?: Record<string, string>;
}

class VitestConfigFile extends FileBase {
  private readonly watch: boolean;
  private readonly environment: string;
  private readonly globals: boolean;
  private readonly setupFiles: string[];
  private readonly plugins: string[];
  private readonly workspaceAliases: Record<string, string>;

  constructor(project: ReactTypeScriptProject, options: VitestConfigOptions) {
    super(project, 'vitest.config.ts');
    this.workspaceAliases = options.workspaceAliases ?? {};
    this.watch = options.watch ?? false;
    this.environment = options.environment ?? 'jsdom';
    this.globals = options.globals ?? true;
    this.setupFiles = options.setupFiles ?? [];
    this.plugins = options.plugins ?? ['react'];
  }

  private synthesizeAliases(): string[] {
    const entries = Object.entries(this.workspaceAliases);
    if (entries.length === 0) {
      return [];
    }
    return [
      '  resolve: {',
      '    alias: {',
      ...entries.map(
        ([alias, relPath]) =>
          `      '${alias}': path.resolve(__dirname, '${relPath}'),`,
      ),
      '    },',
      '  },',
    ];
  }

  protected synthesizeContent(): string | undefined {
    const pluginImports = this.plugins
      .map((p) => `import ${p} from '@vitejs/plugin-${p}';`)
      .join('\n');
    const pluginArray = this.plugins.map((p) => `${p}()`).join(', ');

    return [
      "import path from 'path';",
      "import { defineConfig } from 'vitest/config';",
      "import tsconfigPaths from 'vite-tsconfig-paths';",
      pluginImports,
      '',
      synthesizePackagePathsPluginSource(),
      '',
      'export default defineConfig({',
      `  plugins: [packagePathsPlugin(), tsconfigPaths(), ${pluginArray}],`,
      ...this.synthesizeAliases(),
      '  test: {',
      `    environment: '${this.environment}',`,
      `    globals: ${this.globals},`,
      `    setupFiles: ${JSON.stringify(this.setupFiles)},`,
      `    watch: ${this.watch},`,
      '  },',
      '});',
      '',
    ].join('\n');
  }
}

/**
 * Configures Vitest for a React TypeScript project
 */
export class VitestConfig extends Component {
  constructor(
    project: ReactTypeScriptProject,
    options: VitestConfigOptions = {},
  ) {
    super(project);

    const testDir = options.testDir ?? 'specs';
    const environment = options.environment ?? 'jsdom';

    project.addDevDeps(
      `vitest@${versions.vitest}`,
      `@vitest/ui@${versions['@vitest/ui']}`,
      '@testing-library/react',
      '@testing-library/jest-dom',
      `vite-tsconfig-paths@${versions['vite-tsconfig-paths']}`,
    );
    if (environment === 'jsdom') {
      project.addDevDeps('jsdom');
    }

    project.deps.removeDependency('@types/jest');
    project.deps.removeDependency('jest');
    project.deps.removeDependency('ts-jest');

    project.addScripts({
      test: `bunx vitest run --passWithNoTests ${testDir}`,
      /*
       * The CI variant, which must exist on every project that has a `test`.
       *
       * The root test task runs `turbo run test:ci`, so a project without this
       * script is simply not tested in CI. Adding the task without adding this
       * quietly dropped three packages from the run, which is the kind of silent
       * coverage loss that is hard to notice and easy to cause.
       */
      'test:ci': `bunx vitest run --passWithNoTests --reporter=junit --outputFile=test-results.xml ${testDir}`,
      'test:watch': `bunx vitest ${testDir}`,
      'test:ui': `bunx vitest --ui ${testDir}`,
    });

    // The report is a build artifact, not source. Ignored here as well as in
    // BunTestConfig, because a project uses one of the two and not both.
    project.gitignore.addPatterns('test-results.xml');

    new VitestConfigFile(project, options);

    if (options.sampleCode !== false && options.sampleName) {
      new SampleFile(project, `${testDir}/index.spec.tsx`, {
        contents: [
          "import { describe, it, expect } from 'vitest';",
          '',
          `describe('${options.sampleName}', () => {`,
          "  it('should have basic functionality', () => {",
          '    expect(true).toBe(true);',
          '  });',
          '});',
          '',
        ].join('\n'),
      });
    }
  }
}
