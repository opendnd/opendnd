import { GeneratorContext, childContext, stamp } from '@opendnd/generators';
import { resourceTypes } from '@opendnd/types';
import type {
  Calendar,
  TitleClaim,
  ClaimBasis,
  Event,
  EventType,
  ParticipantRole,
  Character,
  ModelId,
  Population,
  ReferenceTo,
  Relationship,
  RelationshipType,
  Tenure,
  TemporalPosition,
} from '@opendnd/types';

/** Identity of the history simulation as a generator, for provenance. */
export const HISTORY_GENERATOR = { id: 'history', version: '0.1.0' } as const;

export function ref<M extends ModelId>(
  model: M,
  r: { id: string; name?: string },
): ReferenceTo<M> {
  const type = resourceTypes[model];
  return r.name === undefined
    ? { type, id: r.id }
    : { type, id: r.id, display: r.name };
}

export function yearOf(calendar: Calendar, year: number): TemporalPosition {
  return { trs: calendar.id, year, precision: 'year' };
}

export interface EventSpec {
  readonly type: EventType;
  readonly year: number;
  readonly name: string;
  readonly description?: string;
  readonly participant: ReadonlyArray<{
    actor: ReferenceTo<'character'>;
    role: ParticipantRole;
  }>;
  readonly location?: ReferenceTo<'place'>[];
  readonly causedBy?: ReferenceTo<'event'>[];
  readonly partOf?: ReferenceTo<'event'>;
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
    type: spec.type,
    occurred: { begin: yearOf(calendar, spec.year) },
    participant: [...spec.participant],
    ...(spec.location ? { location: spec.location } : {}),
    ...(spec.causedBy ? { causedBy: spec.causedBy } : {}),
    ...(spec.partOf ? { partOf: spec.partOf } : {}),
    ...(spec.outcome ? { outcome: spec.outcome } : {}),
  };
}

export function makeRelationship(
  ctx: GeneratorContext,
  label: string,
  type: RelationshipType,
  party1: Character,
  party2: Character,
  extra: Partial<
    Pick<Relationship, 'fact' | 'legitimacy' | 'successionOrder' | 'validTime'>
  > = {},
): Relationship {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${party1.name} and ${party2.name}: ${type}`,
    perspective: 'in-universe',
    type: type,
    party1: ref('character', party1),
    party2: ref('character', party2),
    ...extra,
  };
}

export function makeTenure(
  ctx: GeneratorContext,
  label: string,
  calendar: Calendar,
  title: ReferenceTo<'title'>,
  holder: Character,
  year: number,
  began?: Event,
): Tenure {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${holder.name}, ${title.display ?? 'title'}`,
    perspective: 'in-universe',
    title,
    holder: ref('character', holder),
    validTime: { begin: yearOf(calendar, year) },
    ...(began ? { began: ref('event', began) } : {}),
  };
}

export function makeClaim(
  ctx: GeneratorContext,
  label: string,
  claimant: Character,
  title: ReferenceTo<'title'>,
  basis: ClaimBasis,
  through?: Character,
): TitleClaim {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${claimant.name}'s claim to ${title.display ?? 'a title'}`,
    perspective: 'in-universe',
    claimant: ref('character', claimant),
    title,
    basis,
    pressed: false,
    ...(through ? { through: ref('character', through) } : {}),
  };
}

export function makePopulation(
  ctx: GeneratorContext,
  label: string,
  calendar: Calendar,
  place: ReferenceTo<'place'>,
  species: ReferenceTo<'species'>,
  culture: ReferenceTo<'culture'> | undefined,
  count: number,
  year: number,
): Population {
  return {
    ...stamp(HISTORY_GENERATOR, childContext(ctx, label)),
    name: `${place.display ?? 'settlement'} population, ${year}`,
    perspective: 'in-universe',
    subject: place,
    species,
    ...(culture ? { culture } : {}),
    count: Math.round(count),
    effective: yearOf(calendar, year),
  };
}
