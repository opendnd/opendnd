import { GeneratorContext, childContext } from '@opendnd/generators';
import type {
  Title,
  Person,
  Reference,
  SuccessionLaw,
  Tenure,
} from '@opendnd/types';
import { Lifecycle, isAdult } from 'src/lifecycle';
import { makeEvent, makeTenure, ref, yearOf } from 'src/resources';
import { HistoryState } from 'src/state';
import type { HistoryInput } from 'src/types';

/**
 * Fills vacant titles. An title falls vacant when its holder died this
 * year; the heir is chosen by the title's succession rule, and a new
 * tenure begins with a succession event caused by the death.
 */
export function succession(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  ctx: GeneratorContext,
): void {
  const year = state.year;
  const yctx = childContext(ctx, `y${year}`);
  const place = ref('place', input.settlement);

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

    const heir = chooseHeir(
      title,
      predecessor,
      input.house.id,
      state,
      lifecycle,
      yctx.rng.child(`heir/${title.id}`),
    );
    const titleRef = ref('title', title);
    if (!heir) {
      state.addEvent(
        makeEvent(yctx, `vacancy/${title.id}`, input.calendar, {
          type: 'succession',
          year,
          name: `${title.name} falls vacant`,
          description: predecessor
            ? `No heir could be found after the death of ${predecessor.name}.`
            : 'No eligible holder could be found.',
          participants: predecessor
            ? [{ actor: ref('person', predecessor), role: 'predecessor' }]
            : [],
          locations: [place],
          ...(deathEvent ? { causedBy: [ref('event', deathEvent)] } : {}),
          outcome: 'vacant',
        }),
      );
      continue;
    }

    const event = makeEvent(yctx, `succession/${title.id}`, input.calendar, {
      type: predecessor ? 'succession' : 'coronation',
      year,
      name: `${heir.name} takes ${title.name}`,
      participants: [
        { actor: ref('person', heir), role: 'successor' },
        ...(predecessor
          ? [{ actor: ref('person', predecessor), role: 'predecessor' }]
          : []),
      ],
      locations: [place],
      ...(deathEvent ? { causedBy: [ref('event', deathEvent)] } : {}),
    });
    state.addEvent(event);
    state.tenures.push(
      makeTenure(
        yctx,
        `tenure/${title.id}/${heir.id}`,
        input.calendar,
        titleRef,
        heir,
        year,
        event,
      ),
    );
  }
}

/**
 * The heir under a rule. Lines of descent are searched depth-first in birth
 * order (primogeniture), then the predecessor's ancestors' lines, so a
 * childless holder is followed by a sibling's line before a cousin's.
 */
export function chooseHeir(
  title: Title,
  predecessor: Person | undefined,
  houseId: string,
  state: HistoryState,
  lifecycle: Lifecycle,
  rng: GeneratorContext['rng'],
): Person | undefined {
  const rule: SuccessionLaw = title.successionLaw;
  const eligible = (p: Person) =>
    state.isAlive(p) &&
    (p.memberOf ?? []).some((m) => m.id === houseId) &&
    (rule !== 'agnatic' || p.sex === 'male');
  const members = state.living().filter(eligible);
  if (members.length === 0) return undefined;

  if (rule === 'elective' || rule === 'appointed') {
    const adults = members.filter((p) => isAdult(state.age(p) ?? 0, lifecycle));
    return adults.length > 0 ? rng.pick(adults) : rng.pick(members);
  }
  if (rule === 'seniority' || !predecessor) {
    return [...members].sort(byAge(state))[0];
  }

  const visited = new Set<string>([predecessor.id]);
  const order = (children: Person[]) => {
    const sorted = [...children].sort(byBirth);
    return rule === 'male-preference'
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
