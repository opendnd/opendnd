import { GeneratorContext, childContext, stamp } from '@opendnd/generators';
import type {
  Calendar,
  Claim,
  ClaimBasis,
  Event,
  EventType,
  Person,
  Population,
  Reference,
  Relationship,
  RelationshipType,
  Tenure,
  TemporalPosition,
} from '@opendnd/types';

/** Identity of the history simulation as a generator, for provenance. */
export const HISTORY_GENERATOR = { id: 'history', version: '0.1.0' } as const;

export function ref(
  model: string,
  r: { id: string; name?: string },
): Reference {
  return r.name === undefined
    ? { model, id: r.id }
    : { model, id: r.id, name: r.name };
}

export function yearOf(calendar: Calendar, year: number): TemporalPosition {
  return { trs: calendar.id, year, precision: 'year' };
}

export interface EventSpec {
  readonly type: EventType;
  readonly year: number;
  readonly name: string;
  readonly description?: string;
  readonly participants: ReadonlyArray<{ actor: Reference; role: string }>;
  readonly locations?: Reference[];
  readonly causedBy?: Reference[];
  readonly partOf?: Reference;
  readonly outcome?: string;
}

export function makeEvent(
  ctx: GeneratorContext,
  label: string,
  calendar: Calendar,
  spec: EventSpec,
): Event {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    perspective: 'in-universe',
    eventType: spec.type,
    when: { begin: yearOf(calendar, spec.year) },
    participants: [...spec.participants],
    ...(spec.locations ? { locations: spec.locations } : {}),
    ...(spec.causedBy ? { causedBy: spec.causedBy } : {}),
    ...(spec.partOf ? { partOf: spec.partOf } : {}),
    ...(spec.outcome ? { outcome: spec.outcome } : {}),
  };
}

export function makeRelationship(
  ctx: GeneratorContext,
  label: string,
  type: RelationshipType,
  person1: Person,
  person2: Person,
  extra: Partial<
    Pick<Relationship, 'facts' | 'legitimacy' | 'successionOrder' | 'validTime'>
  > = {},
): Relationship {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${person1.name} and ${person2.name}: ${type}`,
    perspective: 'in-universe',
    relationshipType: type,
    person1: ref('person', person1),
    person2: ref('person', person2),
    ...extra,
  };
}

export function makeTenure(
  ctx: GeneratorContext,
  label: string,
  calendar: Calendar,
  title: Reference,
  holder: Person,
  year: number,
  began?: Event,
): Tenure {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${holder.name}, ${title.name ?? 'title'}`,
    perspective: 'in-universe',
    title,
    holder: ref('person', holder),
    validTime: { begin: yearOf(calendar, year) },
    ...(began ? { began: ref('event', began) } : {}),
  };
}

export function makeClaim(
  ctx: GeneratorContext,
  label: string,
  claimant: Person,
  title: Reference,
  basis: ClaimBasis,
  through?: Person,
): Claim {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${claimant.name}'s claim to ${title.name ?? 'a title'}`,
    perspective: 'in-universe',
    claimant: ref('person', claimant),
    title,
    basis,
    pressed: false,
    ...(through ? { through: ref('person', through) } : {}),
  };
}

export function makePopulation(
  ctx: GeneratorContext,
  label: string,
  calendar: Calendar,
  place: Reference,
  species: Reference,
  culture: Reference | undefined,
  count: number,
  year: number,
): Population {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${place.name ?? 'settlement'} population, ${year}`,
    perspective: 'in-universe',
    place,
    species,
    ...(culture ? { culture } : {}),
    count: Math.round(count),
    at: yearOf(calendar, year),
  };
}
