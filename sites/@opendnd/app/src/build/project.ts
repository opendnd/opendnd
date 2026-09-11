import type { PageLayout } from './Page';
import { PAGES, RECORD_PAGES, type BuiltInPage } from './pages';
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
  const pages = Array.isArray(resource.page) ? resource.page : [];
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

/**
 * The applications OpenDnD is shipped with.
 *
 * They are projects like any other — the same pages, the same blocks, the
 * same renderer — which is the point: what a world can build for itself is
 * what the application is built from. A world turns one off and its pages go
 * with it, so somebody who wants an atlas and nothing else can have that.
 *
 * The home page is not among them. A world has to have a front page, and an
 * application you cannot turn off is not an application, it is the floor.
 */
export interface BundledApp {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly pages: readonly { readonly path: BuiltInPage; readonly name: string }[];
}

export const BUNDLED: readonly BundledApp[] = [
  {
    id: 'play',
    name: 'Play',
    tagline: 'Campaigns and characters, and the order things happened in.',
    pages: [
      { path: 'campaigns', name: 'Campaigns' },
      { path: 'characters', name: 'Characters' },
      { path: 'timeline', name: 'Timeline' },
    ],
  },
  {
    id: 'atlas',
    name: 'Atlas',
    tagline: 'The world drawn from its own coastlines, at any year.',
    pages: [{ path: 'map', name: 'Map' }],
  },
  {
    id: 'library',
    name: 'Library',
    tagline: 'What the world has written down, and the rules it is played by.',
    pages: [
      { path: 'compendium', name: 'Compendium' },
      { path: 'rules', name: 'Rules' },
    ],
  },
];

/** The front page, which every world has and nobody can turn off. */
export const FLOOR: readonly BuiltInPage[] = ['home'];

/** A bundled application as the project it is. */
export function projectFor(app: BundledApp): Project {
  return {
    id: `bundled:${app.id}`,
    name: app.name,
    tagline: app.tagline,
    status: 'published',
    replaces: [],
    pages: app.pages.map((page) => ({
      id: page.path,
      name: page.name,
      path: page.path,
      scope: 'world' as const,
      layout: PAGES[page.path],
    })),
  };
}

/** Every page the application ships, whether or not a world uses it. */
export function builtIn(): Project {
  return {
    id: 'built-in',
    name: 'OpenDnD',
    tagline: 'The pages every world starts with.',
    status: 'published',
    replaces: [],
    pages: Object.entries(PAGES).map(([path, layout]) => ({
      id: path,
      name:
        BUNDLED.flatMap((app) => app.pages).find((one) => one.path === path)
          ?.name ?? 'Home',
      path,
      scope: 'world' as const,
      layout,
    })),
  };
}

/** Which bundled applications a world has turned off. */
export function appsOff(world: Record<string, unknown> | undefined): Set<string> {
  const apps = (world?.apps ?? {}) as { off?: unknown };
  return new Set(Array.isArray(apps.off) ? apps.off.map(String) : []);
}

/** Whether a world still offers a bundled page. */
export function offers(path: string, off: ReadonlySet<string>): boolean {
  if ((FLOOR as readonly string[]).includes(path)) return true;
  const app = BUNDLED.find((one) =>
    one.pages.some((page) => page.path === path),
  );
  return !app || !off.has(app.id);
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

/**
 * The layout for one record's own page: the world's, when it has published
 * one for this model, and otherwise the one the application ships.
 */
export function recordLayoutFor(
  model: string,
  projects: readonly Project[],
): PageLayout | undefined {
  for (const project of projects) {
    if (project.status !== 'published') continue;
    const page = project.pages.find(
      (one) => one.scope === 'record' && one.model === model,
    );
    if (page) return page.layout;
  }
  return (RECORD_PAGES as Record<string, PageLayout>)[model];
}
