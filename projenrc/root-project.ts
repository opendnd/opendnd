import { BunMonorepoProject } from '@opendnd/projen';

export function configureRootProject() {
  const project = new BunMonorepoProject({
    name: 'opendnd',
    description:
      'An open ontology, headless API and toolset for building fictional worlds. An OpenHI project.',

    /**
     * Code is MIT. This release ships shapes and vocabularies, not game
     * content; CONTENT-LICENSE.md carries the notice for any content that does.
     */
    licensed: true,
    license: 'MIT',
    copyrightOwner: 'OpenDnD contributors',

    /**
     * Layout follows the OpenHI convention: one docs site at /docs, libraries
     * under packages/, deployables under apps/, web front ends under sites/.
     * Every sub-project is scoped @opendnd/<name>.
     */
    scopes: ['@opendnd'],
    workspaces: [
      'packages/@opendnd/*',
      'apps/@opendnd/*',
      'sites/@opendnd/*',
      'docs',
    ],
    devExcludeWorkspaces: ['!./packages/**'],

    gitignore: ['.claude/settings.local.json', '.env', 'data/'],

    env: [
      'OpenDnD monorepo environment variables',
      'Copy this file to .env and fill in your values.',
      '',
      'Database (Postgres everywhere: Docker locally, Neon in the cloud).',
      'The API serves as a role that cannot bypass row-level security, which',
      'is what keeps one world from reading another. Migrations need the owner.',
      'DATABASE_URL=postgres://opendnd_app:opendnd_app@localhost:5432/opendnd',
      'DATABASE_ADMIN_URL=postgres://opendnd:opendnd@localhost:5432/opendnd',
      '',
      'Language models. Nothing here is required: with no variables set the',
      'API talks to an Ollama on the usual port and the model is named per',
      'call. See the @opendnd/llm package page for the full list.',
      'OPENDND_LLM_MODEL=',
      'OLLAMA_URL=http://localhost:11434',
      'AWS_REGION=us-east-1',
    ],
  });

  return project;
}
