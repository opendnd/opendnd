import path from 'path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

import fs from 'fs';
import type { Plugin } from 'vite';

const PACKAGE_PATH_PREFIXES = ['src/', 'specs/'] as const;

function findPackageRoot(importer: string): string | null {
  let dir = path.dirname(importer);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const tsconfigPath = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
          compilerOptions?: { paths?: Record<string, string[]> };
        };
        if (tsconfig.compilerOptions?.paths?.['src/*']) {
          return dir;
        }
      } catch {
        // ignore invalid tsconfig
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function packagePathsPlugin(): Plugin {
  return {
    name: 'opendnd-package-paths',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) {
        return null;
      }

      const isPackagePath =
        source === 'src' ||
        PACKAGE_PATH_PREFIXES.some((prefix) => source.startsWith(prefix));
      if (!isPackagePath) {
        return null;
      }

      const pkgRoot = findPackageRoot(importer);
      if (!pkgRoot) {
        return null;
      }

      const resolved =
        source === 'src'
          ? path.join(pkgRoot, 'src', 'index.ts')
          : path.join(pkgRoot, source);

      const result = await this.resolve(resolved, importer, {
        ...options,
        skipSelf: true,
      });
      return result ?? resolved;
    },
  };
}


export default defineConfig({
  plugins: [packagePathsPlugin(), tsconfigPaths(), tailwindcss(), react()],
  server: {
    port: 4100,
  },
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
    },
  },
});
