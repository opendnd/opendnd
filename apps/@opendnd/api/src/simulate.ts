import type { GeneratorContext } from '@opendnd/generators';
import {
  type HistoryInput,
  type HistoryOutput,
  historyGenerator,
} from '@opendnd/simulation';
import type {
  Calendar,
  Culture,
  Economy,
  Faction,
  ModelId,
  Place,
  Species,
  Title,
} from '@opendnd/types';
import { type Resource, type Store, ValidationError } from './store';

/** Longest run the API will do in one request. */
export const MAX_YEARS = 1000;

/** What a simulation produced, and where it went. */
export interface SimulateResult {
  readonly startYear: number;
  readonly endYear: number;
  readonly counts: Record<string, number>;
  readonly findings: HistoryOutput['findings'];
  /** Present when nothing was saved, so the caller can look before keeping. */
  readonly resources?: Record<string, unknown>[];
  readonly saved: boolean;
}

/**
 * Run the history simulation over a world, or over one house or one place
 * inside it.
 *
 * The realm the simulation needs is read out of the world rather than sent:
 * the places, the houses that hold them, the titles they carry and the
 * economies that say how each settlement is faring. A narrower scope takes
 * the subtree under the resource asked about, so simulating a duchy runs its
 * counties and no one else's.
 */
export async function simulate(
  store: Store,
  scope: { model: ModelId; id: string },
  request: Record<string, unknown>,
  ctx: (seedPath: string) => GeneratorContext,
): Promise<SimulateResult> {
  const years = Number(request.years ?? 100);
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
    throw new ValidationError(
      `years must be a whole number between 1 and ${MAX_YEARS}`,
      [{ path: ['years'], message: 'out of range' }],
    );
  }

  // One at a time: these share a single connection inside the request's
  // transaction, and a Postgres client cannot have two queries in flight.
  const calendar = await only<Calendar>(store, 'calendar', request.calendar);
  const species = await only<Species>(store, 'species', request.species);
  const culture = await only<Culture>(store, 'culture', request.culture);

  const all = {
    places: await every<Place>(store, 'place'),
    factions: await every<Faction>(store, 'faction'),
    titles: await every<Title>(store, 'title'),
    economies: await every<Economy>(store, 'economy'),
  };
  const realm = narrow(all, scope);
  if (realm.titles.length === 0) {
    throw new ValidationError(
      'there is nothing to simulate here: the scope holds no titles',
      [{ path: ['scope'], message: 'no titles' }],
    );
  }

  const startYear = Number(request.startYear ?? 1000);
  if (!Number.isInteger(startYear)) {
    throw new ValidationError('startYear must be a whole number', [
      { path: ['startYear'], message: 'not an integer' },
    ]);
  }
  const input: HistoryInput = {
    calendar,
    species,
    culture,
    places: realm.places,
    factions: realm.factions,
    titles: realm.titles,
    economies: realm.economies,
    startYear,
    years,
    ...(request.params ? { params: request.params as never } : {}),
  };

  const output = historyGenerator.generate(
    input,
    ctx(`history/${scope.model}/${scope.id}/${startYear}-${startYear + years}`),
  );

  const produced: { model: ModelId; body: Record<string, unknown> }[] = [
    ...output.people.map((r) => pair('person', r)),
    ...output.relationships.map((r) => pair('relationship', r)),
    ...output.events.map((r) => pair('event', r)),
    ...output.tenures.map((r) => pair('tenure', r)),
    ...output.claims.map((r) => pair('claim', r)),
    ...output.populations.map((r) => pair('population', r)),
    ...output.economies.map((r) => pair('economy', r)),
  ];
  const counts = {
    person: output.people.length,
    relationship: output.relationships.length,
    event: output.events.length,
    tenure: output.tenures.length,
    claim: output.claims.length,
    population: output.populations.length,
    economy: output.economies.length,
  };

  const save = request.save === true;
  if (save) {
    await store.import(produced, {
      summary: `simulated ${years} years from ${startYear}`,
    });
  }
  return {
    startYear,
    endYear: output.endYear,
    counts,
    findings: output.findings,
    saved: save,
    ...(save ? {} : { resources: produced.map((p) => p.body) }),
  };
}

function pair(
  model: ModelId,
  body: unknown,
): { model: ModelId; body: Record<string, unknown> } {
  return { model, body: body as Record<string, unknown> };
}

/**
 * The one resource of a model this run should use.
 *
 * Named explicitly it is loaded; unnamed it is inferred, but only when the
 * world holds exactly one, because guessing between two calendars would
 * silently date the whole history wrongly.
 */
async function only<T>(
  store: Store,
  model: ModelId,
  named: unknown,
): Promise<T> {
  if (typeof named === 'string') {
    const resource = await store.get(model, named);
    if (!resource) {
      throw new ValidationError(`no ${model} ${named} in this world`, [
        { path: [model], message: 'not found' },
      ]);
    }
    return resource as T;
  }
  const { resources } = await store.list(model, { limit: 2 });
  if (resources.length === 1) return resources[0] as T;
  throw new ValidationError(
    resources.length === 0
      ? `this world has no ${model}, and a simulation needs one`
      : `this world has more than one ${model}; name the one to use`,
    [{ path: [model], message: 'ambiguous' }],
  );
}

/** Every resource of a model in the world, paging until they are all here. */
async function every<T>(store: Store, model: ModelId): Promise<T[]> {
  const out: Resource[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(model, {
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    out.push(...page.resources);
    cursor = page.next;
  } while (cursor !== undefined);
  return out as T[];
}

interface Realm {
  places: Place[];
  factions: Faction[];
  titles: Title[];
  economies: Economy[];
}

/**
 * Cut the realm down to the scope asked about.
 *
 * A world is everything. A faction is that house, the houses beneath it and
 * the places they hold. A place is that place, everything inside it and the
 * houses that hold any of it.
 */
export function narrow(
  all: Realm,
  scope: { model: ModelId; id: string },
): Realm {
  if (scope.model === 'world') return all;

  if (scope.model === 'faction') {
    const houses = descendants(all.factions, scope.id, (f) => f.parent?.id);
    return {
      factions: all.factions.filter((f) => houses.has(f.id)),
      places: all.places.filter(
        (p) => p.controlledBy && houses.has(p.controlledBy.id),
      ),
      titles: all.titles.filter((t) => houses.has(t.faction.id)),
      economies: all.economies.filter((e) =>
        all.places.some(
          (p) =>
            p.id === e.place.id &&
            p.controlledBy &&
            houses.has(p.controlledBy.id),
        ),
      ),
    };
  }

  if (scope.model === 'place') {
    const places = descendants(all.places, scope.id, (p) => p.parent?.id);
    const houses = new Set(
      all.places
        .filter((p) => places.has(p.id) && p.controlledBy)
        .map((p) => p.controlledBy!.id),
    );
    return {
      places: all.places.filter((p) => places.has(p.id)),
      factions: all.factions.filter((f) => houses.has(f.id)),
      titles: all.titles.filter((t) => houses.has(t.faction.id)),
      economies: all.economies.filter((e) => places.has(e.place.id)),
    };
  }

  throw new ValidationError(
    `a ${scope.model} is not something a history can be simulated for; ` +
      'use a world, a faction or a place',
    [{ path: ['model'], message: 'unsupported scope' }],
  );
}

/** A resource and everything whose parent chain reaches it. */
function descendants<T extends { id: string }>(
  items: readonly T[],
  rootId: string,
  parentOf: (item: T) => string | undefined,
): Set<string> {
  const byParent = new Map<string, T[]>();
  for (const item of items) {
    const parent = parentOf(item);
    if (parent === undefined) continue;
    const list = byParent.get(parent) ?? [];
    list.push(item);
    byParent.set(parent, list);
  }
  const found = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (found.has(id)) continue;
    found.add(id);
    for (const child of byParent.get(id) ?? []) queue.push(child.id);
  }
  return found;
}
