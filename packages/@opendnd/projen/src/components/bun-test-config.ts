import { Component, SampleFile } from 'projen';
import { TypeScriptProject } from 'projen/lib/typescript';

export interface BunTestConfigOptions {
  readonly testDir?: string;
  readonly sampleCode?: boolean;
  readonly sampleName?: string;
  /** Bun --preload script run before test files (e.g. browser global shims). */
  readonly preload?: string;
  /**
   * Per-test timeout in milliseconds. Raise it for a package with tests that
   * are slow by design, rather than loosening it for everyone.
   */
  readonly timeout?: number;
  /**
   * Command run before the tests, for a project whose tests need something
   * standing up first. It is prefixed to `test` and `test:ci`, so the usual
   * `bunx projen test` provides it rather than failing on its absence.
   */
  readonly before?: string;
}

/**
 * Per-test timeout, set rather than inherited.
 *
 * Bun's default has moved between versions, so setting it here means a bun
 * upgrade cannot silently change what a timeout means.
 *
 * 5s is sized from measurement. Every test outside `@opendnd/simulation`
 * finishes well under 200ms; the simulation runs centuries of history in one
 * test and reaches about a second. That leaves the slowest legitimate test a
 * comfortable margin while still failing a genuine stall quickly.
 *
 * A single test that is slow by design can carry its own limit as a third
 * argument, `it('...', fn, 120_000)`, which is the narrower tool and
 * preferable to raising this.
 */
const DEFAULT_TEST_TIMEOUT_MS = 5000;

/**
 * Configures Bun test runner for a TypeScript project
 */
export class BunTestConfig extends Component {
  constructor(project: TypeScriptProject, options: BunTestConfigOptions = {}) {
    super(project);

    // Use ./specs so bun does not also pick up compiled copies under dist/**/specs.
    const testDir = options.testDir ?? './specs';
    const preloadArg = options.preload ? ` --preload ${options.preload}` : '';
    const timeoutArg = ` --timeout ${options.timeout ?? DEFAULT_TEST_TIMEOUT_MS}`;
    const before = options.before ? `${options.before} && ` : '';
    const base = `bun test --pass-with-no-tests${timeoutArg}${preloadArg}`;

    project.addScripts({
      test: `${before}${base} ${testDir}`,
      'test:watch': `bun test --watch --pass-with-no-tests${timeoutArg}${preloadArg} ${testDir}`,
      /*
       * The same run, writing a JUnit report as well as console output.
       *
       * Console output is enough for a failure that can be rerun. It is not
       * enough for an intermittent one in CI, which leaves a single line and no
       * way to look closer: which test, how long it took, whether it timed out
       * or asserted. This is what CI runs, so the report exists before anyone
       * needs to reproduce the problem.
       */
      'test:ci': `${before}${base} --reporter=junit --reporter-outfile=./test-results.xml ${testDir}`,
    });

    project.gitignore.addPatterns('test-results.xml');

    if (!project.deps.all.find((dep) => dep.name === '@types/bun')) {
      project.addDevDeps('@types/bun');
    }

    const eslintConfig = project.tryFindObjectFile('.eslintrc.json');
    if (eslintConfig) {
      eslintConfig.addOverride('settings.import/resolver.typescript.bun', true);
    }

    if (options.sampleCode !== false && options.sampleName) {
      new SampleFile(project, `${testDir}/index.spec.ts`, {
        contents: [
          `import { describe, it, expect } from 'bun:test';`,
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
