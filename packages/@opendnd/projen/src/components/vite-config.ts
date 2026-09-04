import { Component, FileBase } from 'projen';
import { ReactTypeScriptProject } from 'projen/lib/web';
import { synthesizePackagePathsPluginSource } from './vite-package-paths-plugin';
import { versions } from '../versions';

export interface ViteProxyTarget {
  /** Backend target URL (e.g. 'http://localhost:4080') */
  readonly target: string;
  /** Rewrite the path before forwarding (e.g. { '^/api': '/api' }) */
  readonly rewrite?: Record<string, string>;
}

export interface ViteConfigOptions {
  readonly port?: number;
  readonly outDir?: string;
  readonly plugins?: string[];
  /** Workspace package aliases for resolve.alias (maps import path to relative src dir) */
  readonly workspaceAliases?: Record<string, string>;
  /** Enable Tailwind CSS v4 via @tailwindcss/vite plugin */
  readonly tailwind?: boolean;
  /** Dev server proxy rules (maps path prefix to target config) */
  readonly proxy?: Record<string, ViteProxyTarget>;
}

class ViteConfigFile extends FileBase {
  private readonly port: number;
  private readonly outDir: string;
  private readonly plugins: string[];
  private readonly workspaceAliases: Record<string, string>;
  private readonly tailwind: boolean;
  private readonly proxy: Record<string, ViteProxyTarget>;

  constructor(project: ReactTypeScriptProject, options: ViteConfigOptions) {
    super(project, 'vite.config.ts');
    this.port = options.port ?? 3000;
    this.outDir = options.outDir ?? 'dist';
    this.plugins = options.plugins ?? ['react'];
    this.workspaceAliases = options.workspaceAliases ?? {};
    this.tailwind = options.tailwind ?? false;
    this.proxy = options.proxy ?? {};
  }

  protected synthesizeContent(): string | undefined {
    const hasAliases = Object.keys(this.workspaceAliases).length > 0;

    const imports: string[] = [];
    imports.push("import path from 'path';");
    imports.push("import { defineConfig } from 'vite';");
    imports.push("import tsconfigPaths from 'vite-tsconfig-paths';");
    if (this.tailwind) {
      imports.push("import tailwindcss from '@tailwindcss/vite';");
    }
    imports.push(
      ...this.plugins.map((p) => `import ${p} from '@vitejs/plugin-${p}';`),
    );

    const allPlugins = [
      'packagePathsPlugin()',
      'tsconfigPaths()',
      ...(this.tailwind ? ['tailwindcss()'] : []),
      ...this.plugins.map((p) => `${p}()`),
    ];
    const pluginArray = allPlugins.join(', ');

    const hasProxy = Object.keys(this.proxy).length > 0;

    const lines: string[] = [
      ...imports,
      '',
      synthesizePackagePathsPluginSource(),
      '',
      'export default defineConfig({',
      `  plugins: [${pluginArray}],`,
      '  server: {',
      `    port: ${this.port},`,
    ];

    if (hasProxy) {
      lines.push('    proxy: {');
      for (const [path, config] of Object.entries(this.proxy)) {
        lines.push(`      '${path}': {`);
        lines.push(`        target: '${config.target}',`);
        if (config.rewrite) {
          for (const [from, to] of Object.entries(config.rewrite)) {
            const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            lines.push(
              `        rewrite: (path) => path.replace(/^${escapedFrom}/, '${to}'),`,
            );
          }
        }
        lines.push('      },');
      }
      lines.push('    },');
    }

    lines.push('  },', '  build: {', `    outDir: '${this.outDir}',`, '  },');

    // Workspace package aliases; src/* paths resolve via vite-tsconfig-paths
    lines.push('  resolve: {');
    lines.push('    alias: {');
    if (hasAliases) {
      for (const [alias, relPath] of Object.entries(this.workspaceAliases)) {
        const singleLine = `      '${alias}': path.resolve(__dirname, '${relPath}'),`;
        if (singleLine.length <= 80) {
          lines.push(singleLine);
        } else {
          lines.push(`      '${alias}': path.resolve(`);
          lines.push(`        __dirname,`);
          lines.push(`        '${relPath}',`);
          lines.push(`      ),`);
        }
      }
    }
    lines.push('    },');
    lines.push('  },');

    lines.push('});');
    lines.push('');

    return lines.join('\n');
  }
}

/**
 * Configures Vite for a React TypeScript project
 */
export class ViteConfig extends Component {
  constructor(
    project: ReactTypeScriptProject,
    options: ViteConfigOptions = {},
  ) {
    super(project);

    project.package.addField('type', 'module');

    if (project.tsconfig?.file) {
      const tsconfig = project.tsconfig.file;
      tsconfig.addOverride('compilerOptions.target', 'ES2020');
      tsconfig.addOverride('compilerOptions.lib', [
        'ES2020',
        'DOM',
        'DOM.Iterable',
      ]);
      tsconfig.addOverride('compilerOptions.module', 'ESNext');
      tsconfig.addOverride('compilerOptions.moduleResolution', 'bundler');
      tsconfig.addOverride('compilerOptions.allowImportingTsExtensions', true);
      tsconfig.addOverride('compilerOptions.isolatedModules', true);
      tsconfig.addOverride('compilerOptions.noEmit', true);
      tsconfig.addOverride('compilerOptions.jsx', 'react-jsx');
    }

    project.addDevDeps(
      `vite-tsconfig-paths@${versions['vite-tsconfig-paths']}`,
    );

    project.addScripts({
      dev: 'bunx vite',
      build: 'bunx vite build',
      preview: 'bunx vite preview',
    });

    new ViteConfigFile(project, options);
  }
}
