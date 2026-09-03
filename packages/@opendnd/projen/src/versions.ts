/**
 * Single source of truth for dependency versions used across the monorepo.
 * Projen config files import from here so every workspace agrees.
 */
export const versions = {
  projen: '^0.103.1',
  typescript: '^5.9.3',
  turbo: '2.10.11',
  bun: '1.4.0',
  'dotenv-mono': '^1.5.1',
  '@types/node': '^24',

  // Docs site
  // ~7.2: astro 7.3.0 (2026-09-03) removed an internal export Starlight 0.41 relies on.
  astro: '~7.2.10',
  '@astrojs/starlight': '^0.41.3',
  '@astrojs/check': '^0.9.4',
  sharp: '^0.35.3',

  // Sites (Vite + React + Vitest)
  vite: '^7.2.6',
  'vite-tsconfig-paths': '^5.1.4',
  '@vitejs/plugin-react': '^5.1.1',
  vitest: '^4.1.10',
  '@vitest/ui': '^4.1.10',
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  '@types/react': '^19.2.0',
  '@types/react-dom': '^19.2.0',
  tailwindcss: '^4.2.2',
  '@tailwindcss/vite': '^4.2.2',

  // Shared runtime libraries
  zod: '^4.3.6',
} as const;
