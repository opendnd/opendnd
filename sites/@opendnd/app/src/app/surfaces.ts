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
  rules: {
    path: 'rules',
    label: 'Rules',
    description:
      'The game itself: classes, backgrounds, feats, items, spells and stat blocks, as this world has them.',
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

/**
 * The groups models are listed in, as the ontology's manifests place them.
 * The icon and the words are the application's; the membership is the
 * ontology's, so a new model lands in its group by saying which it is in.
 */
export interface Category {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export const CATEGORIES: readonly Category[] = [
  {
    key: 'play',
    label: 'Play',
    description: 'Campaigns, sessions, characters, quests and encounters.',
  },
  {
    key: 'people',
    label: 'People',
    description: 'Who is in the world and how they stand to one another.',
  },
  {
    key: 'places',
    label: 'Places',
    description: 'Where things are, and who lives there.',
  },
  {
    key: 'history',
    label: 'History',
    description: 'What happened, and what was written about it.',
  },
  {
    key: 'rules',
    label: 'Rules',
    description: 'The game itself: classes, spells, items and stat blocks.',
  },
  { key: 'world', label: 'World', description: 'The world and its calendars.' },
];

/** The category a model belongs to, or the last one for a model that says none. */
export function categoryOf(model: { category?: string }): Category {
  return (
    CATEGORIES.find((c) => c.key === model.category) ?? {
      key: 'other',
      label: 'Other',
      description: 'Models that name no group.',
    }
  );
}
