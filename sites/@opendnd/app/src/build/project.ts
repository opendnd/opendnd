import type { PageLayout } from './Page';
import { PAGES, type BuiltInPage } from './pages';
import { clampRect, type Placed } from './grid';
import type { Resource } from '../api/types';

/**
 * A world's own pages.
 *
 * A project is an ordinary record holding pages of blocks, which is what buys
 * it revisions, roles, export and a place inside a module without a line of
 * code for any of them. What it costs is this file: a record is loosely typed
 * where a layout is not, so everything coming out of one is checked and
 * clamped on the way in. A page from a world that had a taller grid, or a
 * block with a negative width, becomes a page that draws.
 */

export interface ProjectPage {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly icon?: string;
  readonly scope: 'world' | 'record';
  readonly model?: string;
  readonly layout: PageLayout;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly tagline?: string;
  readonly status: 'draft' | 'published' | 'retired';
  readonly pages: readonly ProjectPage[];
  /** Built-in paths this project stands in front of. */
  readonly replaces: readonly string[];
}

/** A project record, read into the shape the renderer wants. */
export function projectOf(resource: Resource): Project {
  const pages = Array.isArray(resource.pages) ? resource.pages : [];
  return {
    id: String(resource.id),
    name: typeof resource.name === 'string' ? resource.name : 'Untitled',
    ...(typeof resource.tagline === 'string'
      ? { tagline: resource.tagline }
      : {}),
    status:
      resource.status === 'published' || resource.status === 'retired'
        ? resource.status
        : 'draft',
    pages: pages.map((page, index) => pageOf(page, index)),
    replaces: Array.isArray(resource.replaces)
      ? resource.replaces.map(String)
      : [],
  };
}

function pageOf(value: unknown, index: number): ProjectPage {
  const page = (value ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  return {
    id: typeof page.id === 'string' ? page.id : `page-${index + 1}`,
    name: typeof page.name === 'string' ? page.name : 'Untitled page',
    path: typeof page.path === 'string' ? page.path : `page-${index + 1}`,
    ...(typeof page.icon === 'string' ? { icon: page.icon } : {}),
    scope: page.scope === 'record' ? 'record' : 'world',
    ...(typeof page.model === 'string' ? { model: page.model } : {}),
    layout: {
      rows: page.rows === 'fill' ? 'fill' : 'fit',
      blocks: blocks.flatMap((one, at) => placedOf(one, at)),
    },
  };
}

function placedOf(value: unknown, index: number): Placed[] {
  const one = (value ?? {}) as Record<string, unknown>;
  if (typeof one.block !== 'string') return [];
  const rect = clampRect({
    col: number(one.col, 1),
    row: number(one.row, 1),
    w: number(one.w, 1),
    h: number(one.h, 1),
  });
  return [
    {
      id: typeof one.id === 'string' ? one.id : `block-${index + 1}`,
      block: one.block,
      ...rect,
      ...(isPlainObject(one.options) ? { options: one.options } : {}),
    },
  ];
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The pages the application ships with, as a project nobody can edit. */
export function builtIn(): Project {
  const named: Record<BuiltInPage, { name: string; rows?: 'fill' }> = {
    home: { name: 'Home' },
    campaigns: { name: 'Campaigns' },
    characters: { name: 'Characters' },
    compendium: { name: 'Compendium' },
    rules: { name: 'Rules' },
    map: { name: 'Map' },
    timeline: { name: 'Timeline' },
  };
  return {
    id: 'built-in',
    name: 'OpenDnD',
    tagline: 'The pages every world starts with.',
    status: 'published',
    replaces: [],
    pages: Object.entries(PAGES).map(([path, layout]) => ({
      id: path,
      name: named[path as BuiltInPage].name,
      path,
      scope: 'world' as const,
      layout,
    })),
  };
}

/**
 * Which layout a path should draw: a world's own, when it has published one
 * for that path, and otherwise the one the application ships.
 *
 * A draft is only ever seen by somebody who can edit the world, and then only
 * on the canvas. Everyone else sees what was published, which is what makes
 * "publish" mean anything.
 */
export function layoutFor(
  path: string,
  projects: readonly Project[],
): { layout: PageLayout; from?: Project; page?: ProjectPage } {
  for (const project of projects) {
    if (project.status !== 'published') continue;
    const page = project.pages.find((one) => one.path === path);
    if (page) return { layout: page.layout, from: project, page };
  }
  const shipped = builtIn().pages.find((one) => one.path === path);
  return { layout: shipped?.layout ?? { rows: 'fit', blocks: [] } };
}

/** A built-in page copied into a project record, ready to be edited. */
export function copyOf(page: ProjectPage, worldName: string): Record<string, unknown> {
  return {
    name: `${worldName}'s ${page.name.toLowerCase()}`,
    tagline: `A ${page.name.toLowerCase()} page of this world's own.`,
    status: 'draft',
    replaces: [page.path],
    pages: [
      {
        id: page.id,
        name: page.name,
        // A copy answers to the same address, so customizing a page
        // replaces it rather than adding a second one beside it.
        path: page.path,
        scope: page.scope,
        rows: page.layout.rows,
        blocks: page.layout.blocks.map((one) => ({ ...one })),
      },
    ],
  };
}
