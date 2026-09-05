import { GeneratorContext, childContext } from '@opendnd/generators';
import type {
  Person,
  Reference,
  SuccessionLaw,
  Tenure,
  Title,
} from '@opendnd/types';
import { Lifecycle, isAdult } from '../lifecycle';
import {
  makeClaim,
  makeEvent,
  makeRelationship,
  makeTenure,
  ref,
  yearOf,
} from '../resources';
import { HistoryState } from '../state';
import type { HistoryInput } from '../types';

/**
 * Fills vacant titles across the realm and re-ties vassalage.
 *
 * A title falls vacant when its holder dies; the heir comes from the title's
 * own house under its succession law, and a new tenure begins with a
 * succession event caused by the death. Whenever a title changes hands, the
 * liege-vassal bonds between the new holder and their liege, and between
 * them and their own vassals, are recorded afresh, because homage is between
 * people and does not outlive them.
 */
export function succession(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  ctx: GeneratorContext,
): void {
  const year = state.year;
  const yctx = childContext(ctx, `y${year}`);
  const changed: Title[] = [];

  for (const title of input.titles) {
    const current = state.currentTenure(title.id);
    if (current && state.isAlive(state.person(current.holder.id))) continue;

    const predecessor = current ? state.person(current.holder.id) : undefined;
    const deathEvent = predecessor
      ? state.events.find(
          (e) =>
            e.eventType === 'death' &&
            e.when.begin?.year === year &&
            e.participants?.some(
              (p) => p.actor.id === predecessor.id && p.role === 'deceased',
            ),
        )
      : undefined;

    if (current && predecessor) {
      const mutable = current as {
        ended?: Reference;
        validTime?: Tenure['validTime'];
      };
      mutable.validTime = {
        ...(current.validTime ?? {}),
        end: yearOf(input.calendar, year),
      };
      if (deathEvent) mutable.ended = ref('event', deathEvent);
    }

    const seat = state.houses.get(title.faction.id)?.seat;
    const rng = yctx.rng.child(`heir/${title.id}`);
    const direct = chooseHeir(
      title,
      predecessor,
      title.faction.id,
      state,
      lifecycle,
      rng,
    );
    // A house with no one left to inherit is not the end of the title: the
    // liege seats one of their own junior kin, who founds a cadet branch.
    const cadet = direct ? undefined : investCadet(state, title, lifecycle);
    const heir = direct ?? cadet;
    if (!heir) {
      if (!state.vacant.has(title.id)) {
        state.vacant.add(title.id);
        state.addEvent(
          makeEvent(yctx, `vacancy/${title.id}`, input.calendar, {
            type: 'succession',
            year,
            name: `${title.name} falls vacant`,
            description: predecessor
              ? `No heir could be found after the death of ${predecessor.name}.`
              : 'No eligible holder could be found.',
            participants: predecessor
              ? [
                  {
                    actor: ref('person', predecessor),
                    role: 'predecessor' as const,
                  },
                ]
              : [],
            ...(seat ? { locations: [seat] } : {}),
            ...(deathEvent ? { causedBy: [ref('event', deathEvent)] } : {}),
            outcome: 'vacant',
          }),
        );
      }
      continue;
    }
    state.vacant.delete(title.id);

    const event = makeEvent(yctx, `succession/${title.id}`, input.calendar, {
      type: predecessor ? 'succession' : 'coronation',
      year,
      name: `${heir.name} takes ${title.name}`,
      ...(cadet
        ? {
            description: `${cadet.name} founds a cadet branch of ${state.houses.get(state.houseOf(cadet.id)!)?.name ?? 'the house'}.`,
          }
        : {}),
      participants: [
        { actor: ref('person', heir), role: 'successor' },
        ...(predecessor
          ? [
              {
                actor: ref('person', predecessor),
                role: 'predecessor' as const,
              },
            ]
          : []),
      ],
      ...(seat ? { locations: [seat] } : {}),
      ...(deathEvent ? { causedBy: [ref('event', deathEvent)] } : {}),
    });
    state.addEvent(event);
    state.tenures.push(
      makeTenure(
        yctx,
        `tenure/${title.id}/${heir.id}`,
        input.calendar,
        ref('title', title),
        heir,
        year,
        event,
      ),
    );
    recordClaims(state, title, predecessor, heir, yctx);
    changed.push(title);
  }

  for (const title of changed) homage(state, input, title, yctx);
}

/**
 * A law that prefers sons does not persuade the daughters it passes over.
 * Each keeps a claim to the title, which their line may one day press.
 */
function recordClaims(
  state: HistoryState,
  title: Title,
  predecessor: Person | undefined,
  heir: Person,
  yctx: GeneratorContext,
): void {
  if (!predecessor) return;
  if (
    title.successionLaw !== 'male-preference' &&
    title.successionLaw !== 'agnatic'
  ) {
    return;
  }
  const heirBorn = heir.birth?.time?.year ?? 0;
  for (const child of state.children(predecessor.id)) {
    if (child.id === heir.id || !state.isAlive(child)) continue;
    if (child.sex === 'male') continue;
    if ((child.birth?.time?.year ?? 0) >= heirBorn) continue;
    const already = state.claims.some(
      (c) =>
        c.claimant.id === child.id &&
        c.title.id === title.id &&
        c.resolvedBy === undefined,
    );
    if (already) continue;
    state.claims.push(
      makeClaim(
        yctx,
        `claim/${title.id}/${child.id}`,
        child,
        ref('title', title),
        'inheritance',
        predecessor,
      ),
    );
  }
}

/**
 * Seat a junior member of the liege's house on a title whose own house has
 * died out. They move into the vassal house, which is how a cadet branch
 * begins, and the line continues rather than the realm hollowing out.
 */
function investCadet(
  state: HistoryState,
  title: Title,
  lifecycle: Lifecycle,
): Person | undefined {
  const liegeHouse = state.houses.get(title.faction.id)?.parent?.id;
  if (liegeHouse === undefined) return undefined;
  const liegeTitle = state.titleOfHouse(liegeHouse);
  const liege = liegeTitle
    ? state.currentTenure(liegeTitle.id)?.holder.id
    : undefined;
  const candidates = state
    .livingMembers(liegeHouse)
    .filter((p) => p.id !== liege && isAdult(state.age(p) ?? -1, lifecycle));
  if (candidates.length === 0) return undefined;
  // The youngest adult: the one with least claim at home.
  const cadet = [...candidates].sort(
    (a, b) => (state.age(a) ?? 0) - (state.age(b) ?? 0),
  )[0];
  state.movePersonToHouse(cadet, title.faction.id);
  return cadet;
}

/**
 * Record the bonds a new holder owes and is owed: one up to their liege, one
 * down from each vassal whose title is currently held.
 */
function homage(
  state: HistoryState,
  input: HistoryInput,
  title: Title,
  yctx: GeneratorContext,
): void {
  const holder = holderOf(state, title.id);
  if (!holder) return;
  const houseId = title.faction.id;

  const liegeHouse = state.houses.get(houseId)?.parent?.id;
  const liege = liegeHouse ? holderOfHouse(state, liegeHouse) : undefined;
  if (liege && liege.id !== holder.id) bond(state, input, yctx, liege, holder);

  for (const house of state.houses.values()) {
    if (house.parent?.id !== houseId) continue;
    const vassalTitle = state.titleOfHouse(house.id);
    const vassal = vassalTitle ? holderOf(state, vassalTitle.id) : undefined;
    if (vassal && vassal.id !== holder.id) {
      bond(state, input, yctx, holder, vassal);
    }
  }
}

function bond(
  state: HistoryState,
  input: HistoryInput,
  yctx: GeneratorContext,
  liege: Person,
  vassal: Person,
): void {
  const already = state.relationships.some(
    (r) =>
      r.relationshipType === 'liege-vassal' &&
      r.party1.id === liege.id &&
      r.party2.id === vassal.id,
  );
  if (already) return;
  state.addRelationship(
    makeRelationship(
      yctx,
      `homage/${liege.id}/${vassal.id}`,
      'liege-vassal',
      liege,
      vassal,
      {
        facts: [{ type: 'homage', time: yearOf(input.calendar, state.year) }],
        validTime: { begin: yearOf(input.calendar, state.year) },
      },
    ),
  );
}

function holderOf(state: HistoryState, titleId: string): Person | undefined {
  const tenure = state.currentTenure(titleId);
  if (!tenure) return undefined;
  const person = state.person(tenure.holder.id);
  return state.isAlive(person) ? person : undefined;
}

function holderOfHouse(
  state: HistoryState,
  houseId: string,
): Person | undefined {
  const title = state.titleOfHouse(houseId);
  return title ? holderOf(state, title.id) : undefined;
}

/**
 * The heir under a title's law. Lines of descent are searched depth-first in
 * birth order, then the predecessor's ancestors' lines, so a childless holder
 * is followed by a sibling's line before a cousin's.
 */
export function chooseHeir(
  title: Title,
  predecessor: Person | undefined,
  houseId: string,
  state: HistoryState,
  lifecycle: Lifecycle,
  rng: GeneratorContext['rng'],
): Person | undefined {
  const law: SuccessionLaw = title.successionLaw;
  const eligible = (p: Person) =>
    state.isAlive(p) &&
    state.houseOf(p.id) === houseId &&
    (law !== 'agnatic' || p.sex === 'male');
  const members = state.livingMembers(houseId).filter(eligible);
  if (members.length === 0) return undefined;

  if (law === 'elective' || law === 'appointed') {
    const adults = members.filter((p) => isAdult(state.age(p) ?? 0, lifecycle));
    return adults.length > 0 ? rng.pick(adults) : rng.pick(members);
  }
  if (law === 'seniority' || !predecessor) {
    return [...members].sort(byAge(state))[0];
  }

  const visited = new Set<string>([predecessor.id]);
  const order = (children: Person[]) => {
    const sorted = [...children].sort(byBirth);
    return law === 'male-preference'
      ? [
          ...sorted.filter((c) => c.sex === 'male'),
          ...sorted.filter((c) => c.sex !== 'male'),
        ]
      : sorted;
  };
  const heirOf = (person: Person): Person | undefined => {
    for (const child of order(state.children(person.id))) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (eligible(child)) return child;
      const grand = heirOf(child);
      if (grand) return grand;
    }
    return undefined;
  };

  // Descendants first, then each generation of ancestors' other lines.
  let frontier: Person[] = [predecessor];
  while (frontier.length > 0) {
    for (const person of frontier) {
      const heir = heirOf(person);
      if (heir) return heir;
    }
    const next: Person[] = [];
    for (const person of frontier) {
      for (const parent of state.parents(person.id)) {
        if (!visited.has(parent.id)) {
          visited.add(parent.id);
          if (eligible(parent)) return parent;
          next.push(parent);
        }
      }
    }
    frontier = next;
  }
  return [...members].sort(byAge(state))[0];
}

function byBirth(a: Person, b: Person): number {
  return (a.birth?.time?.year ?? 0) - (b.birth?.time?.year ?? 0);
}

function byAge(state: HistoryState) {
  return (a: Person, b: Person) => (state.age(b) ?? 0) - (state.age(a) ?? 0);
}
