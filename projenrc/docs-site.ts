import { versions } from '@opendnd/projen';
import { JsonFile, Project } from 'projen';

const DOCS_PORT = 4330;

/**
 * The single monorepo-wide Starlight docs site at /docs (OpenHI layout).
 * Astro owns its own config, so this is a plain projen Project that only
 * manages package.json; content and astro.config.mjs are hand-maintained.
 */
export function configureDocsSite(parent: Project): Project {
  const project = new Project({
    name: '@opendnd/docs',
    outdir: 'docs',
    parent,
  });

  project.gitignore.addPatterns('dist/', '.astro/');

  new JsonFile(project, 'package.json', {
    obj: {
      name: '@opendnd/docs',
      version: '0.0.0',
      private: true,
      type: 'module',
      description: 'OpenDnD documentation site',
      scripts: {
        dev: `astro dev --port ${DOCS_PORT}`,
        start: `astro dev --port ${DOCS_PORT}`,
        build: 'astro build',
        preview: 'astro preview',
        astro: 'astro',
        test: 'astro check --minimumSeverity error',
        'test:ci': 'astro check --minimumSeverity error',
      },
      dependencies: {
        '@astrojs/starlight': versions['@astrojs/starlight'],
        astro: versions.astro,
        sharp: versions.sharp,
      },
      devDependencies: {
        '@astrojs/check': versions['@astrojs/check'],
        '@types/node': versions['@types/node'],
        typescript: versions.typescript,
      },
    },
  });

  return project;
}
