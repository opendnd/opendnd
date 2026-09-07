import type { Ontology } from '../schema/openapi';

/**
 * The application's product surfaces and the model each one is built on.
 *
 * Everything else in the application learns the models from the API, and the
 * generic pages need no list like this. The navigation, though, has a shape
 * a person expects, campaigns beside characters beside the compendium, and
 * that shape has to name what it is made of. This is the one place it does.
 * A surface whose model the ontology lacks is simply not offered.
 */
export interface Surface {
  readonly path: string;
  readonly label: string;
  /** The model the surface lists, or none for a surface that spans them all. */
  readonly model?: string;
  readonly description: string;
}

export const SURFACES = {
  campaigns: {
    path: 'campaigns',
    label: 'Campaigns',
    model: 'campaign',
    description:
      'The games played in this world, with their sessions, parties and quests.',
  },
  characters: {
    path: 'characters',
    label: 'Characters',
    model: 'character',
    description:
      'The people as played: sheets, levels and the campaigns they belong to.',
  },
  map: {
    path: 'map',
    label: 'Maps',
    description: 'The world drawn from its cells, at any year.',
  },
  timeline: {
    path: 'timeline',
    label: 'Timeline',
    description: 'Everything dated, in the order it began.',
  },
  compendium: {
    path: 'compendium',
    label: 'Compendium',
    model: 'work',
    description:
      'Articles, chronicles and tales, and a search across everything on record.',
  },
  marketplace: {
    path: 'marketplace',
    label: 'Marketplace',
    description:
      'Modules: content published from worlds, to enable in this one.',
  },
  data: {
    path: 'data',
    label: 'Data',
    description:
      'Every kind of record the API serves, as tables, with export and import.',
  },
  settings: {
    path: 'settings',
    label: 'Settings',
    description: "The world's name, members, spend and archiving.",
  },
} as const satisfies Record<string, Surface>;

export type SurfaceKey = keyof typeof SURFACES;

/** The path segments that are surfaces rather than models, for addresses and breadcrumbs. */
export const SURFACE_SEGMENTS: ReadonlySet<string> = new Set([
  ...Object.values(SURFACES).map((s) => s.path),
  'search',
]);

/** The label a surface segment shows in a breadcrumb. */
export function surfaceLabel(segment: string): string | undefined {
  if (segment === 'search') return SURFACES.compendium.label;
  return Object.values(SURFACES).find((s) => s.path === segment)?.label;
}

/** Whether the ontology can back a surface: it has the model, or needs none. */
export function offers(ontology: Ontology, surface: Surface): boolean {
  return (
    surface.model === undefined || ontology.model(surface.model) !== undefined
  );
}
