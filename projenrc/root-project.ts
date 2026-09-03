import { BunMonorepoProject } from '@opendnd/projen';

export function configureRootProject() {
  const project = new BunMonorepoProject({
    name: 'opendnd',
    description:
      'An open ontology, headless API and toolset for building fictional worlds. An OpenHI project.',

    /**
     * Code is MIT. Game content shipped in this repo (SRD 5.2.1) is CC-BY-4.0
     * and carries its own notice in CONTENT-LICENSE.md.
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
      'Database (Postgres everywhere: Docker locally, Neon in the cloud)',
      'DATABASE_URL=postgres://opendnd:opendnd@localhost:5432/opendnd',
      '',
      'AI (Amazon Bedrock)',
      'AWS_REGION=us-east-1',
      'BEDROCK_MODEL_ID=',
    ],
  });

  return project;
}
