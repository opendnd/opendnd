import { GeneratorContext, childContext } from '@opendnd/generators';
import type { Person, Reference, Tenure } from '@opendnd/types';
import { makeEvent, makeTenure, ref, yearOf } from '../resources';
import { HistoryState, War } from '../state';
import type { HistoryInput, HistoryParams } from '../types';

/**
 * War: the pressing of claims by force.
 *
 * A live claim may be pressed by its claimant, which declares a war between
 * their house and the house holding the title. Each year of a war fights one
 * battle, decided by a weighted roll on the two sides' strength, which is the
 * people living in the lands each house and its vassals hold. The side that
 * first wins enough battles carries the war: the claimant is installed and
 * the sitting holder deposed, or the claim is broken. Battles hang off the
 * war through `partOf`, so a chronicle can tell the war as one story.
 */
export function conflict(
  state: HistoryState,
  input: HistoryInput,
  params: HistoryParams,
  ctx: GeneratorContext,
): void {
  const year = state.year;
  const yctx = childContext(ctx, `y${year}`);

  for (const war of [...state.wars]) {
    fightBattle(state, input, params, war, yctx);
  }
  declareWars(state, input, params, yctx);
}

/** One year of a war: a battle, and possibly a conclusion. */
function fightBattle(
  state: HistoryState,
  input: HistoryInput,
  params: HistoryParams,
  war: War,
  yctx: GeneratorContext,
): void {
  const year = state.year;
  const claimant = state.person(war.claimantId);
  const holder = holderOf(state, war.titleId);

  // A war needs someone to press it and someone to press it against.
  if (!state.isAlive(claimant) || !holder) {
    conclude(state, input, war, year, 'inconclusive', yctx);
    return;
  }
  if (year - war.startedIn >= params.maxWarYears) {
    conclude(state, input, war, year, 'exhausted', yctx);
    return;
  }

  const rng = yctx.rng.child(`battle/${war.event.id}`);
  const attack = state.strengthOf(war.attacker);
  const defend = state.strengthOf(war.defender);
  const attackerWon =
    attack + defend === 0
      ? rng.chance()
      : rng.next() < attack / (attack + defend);
  if (attackerWon) war.attackerWins++;
  else war.defenderWins++;

  const field = state.seatOf(war.defender);
  const victor = attackerWon ? claimant : holder;
  state.addEvent(
    makeEvent(yctx, `battle/${war.event.id}`, input.calendar, {
      type: 'battle',
      year,
      name: `Battle of ${fieldName(field?.name)}, ${year}`,
      description: `${victor.name} holds the field.`,
      participants: [
        { actor: ref('person', claimant), role: 'attacker' },
        { actor: ref('person', holder), role: 'defender' },
        { actor: ref('person', victor), role: 'victor' },
      ],
      ...(field ? { locations: [field] } : {}),
      partOf: ref('event', war.event),
      outcome: attackerWon ? 'attacker' : 'defender',
    }),
  );

  if (war.attackerWins >= params.battlesToWin) {
    conclude(state, input, war, year, 'attacker', yctx, claimant, holder);
  } else if (war.defenderWins >= params.battlesToWin) {
    conclude(state, input, war, year, 'defender', yctx, claimant, holder);
  }
}

/** End a war, settle the title, and close the claim. */
function conclude(
  state: HistoryState,
  input: HistoryInput,
  war: War,
  year: number,
  outcome: 'attacker' | 'defender' | 'inconclusive' | 'exhausted',
  yctx: GeneratorContext,
  claimant?: Person,
  holder?: Person,
): void {
  state.wars.splice(state.wars.indexOf(war), 1);
  const event = war.event as {
    when: { begin?: unknown; end?: unknown };
    outcome?: string;
  };
  event.when = { ...event.when, end: yearOf(input.calendar, year) };
  event.outcome = outcome;

  const claim = war.claim as { resolvedBy?: Reference };
  claim.resolvedBy = ref('event', war.event);

  if (outcome !== 'attacker' || !claimant || !holder) return;

  const title = state.titlesById.get(war.titleId)!;
  const seat = state.seatOf(war.defender);
  const deposition = makeEvent(
    yctx,
    `deposition/${war.event.id}`,
    input.calendar,
    {
      type: 'deposition',
      year,
      name: `${holder.name} is deposed from ${title.name}`,
      participants: [
        { actor: ref('person', holder), role: 'deposed' },
        { actor: ref('person', claimant), role: 'successor' },
      ],
      ...(seat ? { locations: [seat] } : {}),
      causedBy: [ref('event', war.event)],
      partOf: ref('event', war.event),
    },
  );
  state.addEvent(deposition);

  const current = state.currentTenure(war.titleId);
  if (current) {
    const mutable = current as {
      ended?: Reference;
      validTime?: Tenure['validTime'];
    };
    mutable.validTime = {
      ...(current.validTime ?? {}),
      end: yearOf(input.calendar, year),
    };
    mutable.ended = ref('event', deposition);
  }

  // The victor takes the seat, and their line continues the house.
  state.movePersonToHouse(claimant, title.faction.id);
  state.vacant.delete(title.id);
  const accession = makeEvent(
    yctx,
    `accession/${war.event.id}`,
    input.calendar,
    {
      type: 'succession',
      year,
      name: `${claimant.name} takes ${title.name}`,
      description: `Won by force of arms.`,
      participants: [
        { actor: ref('person', claimant), role: 'successor' },
        { actor: ref('person', holder), role: 'predecessor' },
      ],
      ...(seat ? { locations: [seat] } : {}),
      causedBy: [ref('event', deposition)],
    },
  );
  state.addEvent(accession);
  state.tenures.push(
    makeTenure(
      yctx,
      `tenure/${title.id}/${claimant.id}`,
      input.calendar,
      ref('title', title),
      claimant,
      year,
      accession,
    ),
  );
}

/** Live claims may be pressed, one war per title at a time. */
function declareWars(
  state: HistoryState,
  input: HistoryInput,
  params: HistoryParams,
  yctx: GeneratorContext,
): void {
  const year = state.year;
  const contested = new Set(state.wars.map((w) => w.titleId));

  for (const claim of state.claims) {
    if (claim.resolvedBy !== undefined) continue;
    if (contested.has(claim.title.id)) continue;
    const claimant = state.people.get(claim.claimant.id);
    if (!claimant || !state.isAlive(claimant)) continue;

    const holder = holderOf(state, claim.title.id);
    if (!holder || holder.id === claimant.id) continue;
    const attacker = state.houseOf(claimant.id);
    const defender = state.houseOf(holder.id);
    if (!attacker || !defender || attacker === defender) continue;

    const rng = yctx.rng.child(`war/${claim.id}`);
    if (rng.next() >= params.warChance) continue;

    const title = state.titlesById.get(claim.title.id)!;
    const event = makeEvent(yctx, `war/${claim.id}`, input.calendar, {
      type: 'war',
      year,
      name: `War for ${title.name}`,
      description: `${claimant.name} presses a claim to ${title.name} against ${holder.name}.`,
      participants: [
        { actor: ref('person', claimant), role: 'claimant' },
        { actor: ref('person', holder), role: 'holder' },
      ],
      ...(state.seatOf(defender)
        ? { locations: [state.seatOf(defender)!] }
        : {}),
    });
    state.addEvent(event);
    (claim as { pressed?: boolean }).pressed = true;
    state.wars.push({
      event,
      titleId: claim.title.id,
      claim,
      claimantId: claimant.id,
      attacker,
      defender,
      startedIn: year,
      attackerWins: 0,
      defenderWins: 0,
    });
    contested.add(claim.title.id);
  }
}

/**
 * A battle is fought at a place, not at a rank: "Battle of Itumeist", never
 * "Battle of County of Itumeist".
 */
function fieldName(name: string | undefined): string {
  if (!name) return 'the field';
  return name.replace(/^(Kingdom|Duchy|County) of /, '');
}

function holderOf(state: HistoryState, titleId: string): Person | undefined {
  const tenure = state.currentTenure(titleId);
  if (!tenure) return undefined;
  const person = state.person(tenure.holder.id);
  return state.isAlive(person) ? person : undefined;
}
