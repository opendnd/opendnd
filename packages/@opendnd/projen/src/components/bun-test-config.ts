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
}

/**
 * Per-test timeout, set rather than inherited.
 *
 * Bun's default has moved between versions: a stalled test failed at 10s under
 * one and 5s under another, in the same repository on the same day, because two
 * bun versions were installed. Setting it here means a bun upgrade cannot
 * silently change what a timeout means.
 *
 * 5s is sized from measurement, not taste. Across 894 tests, everything outside
 * `@opendnd/projen` finishes in under 150ms; projen's own tests synthesize
 * whole projects and reach 2.2s. So this leaves the slowest legitimate test
 * better than a 2x margin while failing a genuine stall in half the time it
 * used to take.
 *
 * A single test that is slow by design can carry its own limit as a third
 * argument, `it('...', fn, 120_000)`, which is the narrower tool and preferable
 * to raising this.
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
    const base = `bun test --pass-with-no-tests${timeoutArg}${preloadArg}`;

    project.addScripts({
      test: `${base} ${testDir}`,
      'test:watch': `bun test --watch --pass-with-no-tests${timeoutArg}${preloadArg} ${testDir}`,
      /*
       * The same run, writing a JUnit report as well as console output.
       *
       * Console output is fine when you can rerun the failure. It is useless for
       * an intermittent one in CI, where you get a single line and no way to look
       * closer: which test, how long it actually took, whether it timed out or
       * asserted. This is what CI runs, so the report is there when it is needed
       * rather than after somebody reproduces the problem.
       */
      'test:ci': `${base} --reporter=junit --reporter-outfile=./test-results.xml ${testDir}`,
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
