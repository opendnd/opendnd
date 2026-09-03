import { Component, TextFile } from 'projen';
import type { BunMonorepoProject } from './bun-monorepo-project';

export interface AgentDocsConfigOptions {
  /** Hand-maintained agent guide at the repo root. */
  readonly canonicalFile?: string;
  /** Generated pointer for Claude Code. */
  readonly claudeFile?: string;
}

/**
 * Generates `CLAUDE.md` as a pointer to the canonical `AGENTS.md` guide.
 * Edit `AGENTS.md` directly; run `bunx projen` to refresh `CLAUDE.md`.
 */
export class AgentDocsConfig extends Component {
  constructor(
    project: BunMonorepoProject,
    options: AgentDocsConfigOptions = {},
  ) {
    super(project);

    const canonical = options.canonicalFile ?? 'AGENTS.md';
    const claude = options.claudeFile ?? 'CLAUDE.md';

    new TextFile(project, claude, {
      marker: true,
      lines: [
        '# CLAUDE.md',
        '',
        `See [${canonical}](./${canonical}) for project instructions.`,
        '',
        `> ${canonical} is the canonical contributor and agent guide. This file is generated for Claude Code compatibility.`,
        '',
      ],
    });
  }
}
