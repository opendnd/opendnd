import type {
  Event,
  Person,
  Relationship,
  Species,
  Tenure,
} from '@opendnd/types';
import { lifecycleOf } from './lifecycle';
import type { Finding } from './types';

export interface HistoryRecord {
  readonly people: readonly Person[];
  readonly relationships: readonly Relationship[];
  readonly events: readonly Event[];
  readonly tenures: readonly Tenure[];
  readonly species?: Species;
}

/**
 * Deterministic consistency rules over a structured history. This is the
 * first layer of the consistency checker (ADR-008): it never guesses, it
 * only reports contradictions the record itself proves. A second, LLM-based
 * layer reads prose and tests its claims against the same record.
 */
export function checkHistory(record: HistoryRecord): Finding[] {
  const findings: Finding[] = [];
  const people = new Map(record.people.map((p) => [p.id, p]));
  const deathYear = new Map<string, number>();
  for (const p of record.people) {
    const y = p.death?.time?.year;
    if (y !== undefined) deathYear.set(p.id, y);
  }
  for (const e of record.events) {
    if (e.eventType !== 'death') continue;
    const y = e.when.begin?.year;
    for (const part of e.participants ?? []) {
      if (part.role === 'deceased' && y !== undefined) {
        const recorded = deathYear.get(part.actor.id);
        if (recorded !== undefined && recorded !== y) {
          findings.push({
            rule: 'death-year-agrees',
            severity: 'error',
            message: `${name(people, part.actor.id)} dies in ${y} in an event but ${recorded} on their record`,
            resources: [e.id, part.actor.id],
          });
        }
        deathYear.set(part.actor.id, recorded ?? y);
      }
    }
  }

  // No one takes part in anything after they die, except in their own death.
  for (const e of record.events) {
    const y = e.when.begin?.year;
    if (y === undefined) continue;
    for (const part of e.participants ?? []) {
      const died = deathYear.get(part.actor.id);
      if (died === undefined) continue;
      // Dying, being widowed, and being succeeded may all fall in the death year.
      const allowedInDeathYear =
        e.eventType === 'death' || e.eventType === 'succession';
      if (y > died || (y === died && !allowedInDeathYear)) {
        findings.push({
          rule: 'no-posthumous-participation',
          severity: 'error',
          message: `${name(people, part.actor.id)} takes part in "${e.name}" in ${y} but died in ${died}`,
          resources: [e.id, part.actor.id],
        });
      }
    }
    // Nobody is born before their parents are adults or after a parent has died.
    if (e.eventType === 'birth') {
      const child = e.participants?.find((p) => p.role === 'child');
      for (const role of ['mother', 'father']) {
        const parent = e.participants?.find((p) => p.role === role);
        if (!parent || !child) continue;
        const pBorn = people.get(parent.actor.id)?.birth?.time?.year;
        if (pBorn !== undefined && record.species) {
          const age = y - pBorn;
          const lc = lifecycleOf(record.species);
          if (age < lc.maturity || (role === 'mother' && age > lc.fertileTo)) {
            findings.push({
              rule: 'parent-age-plausible',
              severity: 'error',
              message: `${name(people, parent.actor.id)} is ${age} at the birth of ${name(people, child.actor.id)} in ${y}`,
              resources: [e.id, parent.actor.id, child.actor.id],
            });
          }
        }
        const pDied = deathYear.get(parent.actor.id);
        if (pDied !== undefined && pDied < y - (role === 'father' ? 1 : 0)) {
          findings.push({
            rule: 'parent-alive-at-birth',
            severity: 'error',
            message: `${name(people, parent.actor.id)} died in ${pDied} but is ${role} of a child born in ${y}`,
            resources: [e.id, parent.actor.id],
          });
        }
      }
    }
  }

  // One holder per title at a time, and holders are alive while they hold.
  const byTitle = new Map<string, Tenure[]>();
  for (const t of record.tenures) {
    const list = byTitle.get(t.title.id) ?? [];
    list.push(t);
    byTitle.set(t.title.id, list);
    const begin = t.validTime?.begin?.year;
    const end = t.validTime?.end?.year;
    const died = deathYear.get(t.holder.id);
    if (died !== undefined && (end === undefined || end > died)) {
      findings.push({
        rule: 'holder-alive-during-tenure',
        severity: 'error',
        message: `${name(people, t.holder.id)} holds ${t.title.name ?? t.title.id} past their death in ${died}`,
        resources: [t.id, t.holder.id],
      });
    }
    if (begin !== undefined && end !== undefined && end < begin) {
      findings.push({
        rule: 'tenure-ends-after-it-begins',
        severity: 'error',
        message: `Tenure ${t.name} ends in ${end} before it begins in ${begin}`,
        resources: [t.id],
      });
    }
  }
  for (const [titleId, tenures] of byTitle) {
    const sorted = [...tenures].sort(
      (a, b) =>
        (a.validTime?.begin?.year ?? 0) - (b.validTime?.begin?.year ?? 0),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].validTime?.end?.year;
      const nextBegin = sorted[i].validTime?.begin?.year;
      if (
        prevEnd === undefined ||
        (nextBegin !== undefined && nextBegin < prevEnd)
      ) {
        findings.push({
          rule: 'one-holder-at-a-time',
          severity: 'error',
          message: `Two tenures of ${sorted[i].title.name ?? titleId} overlap`,
          resources: [sorted[i - 1].id, sorted[i].id],
        });
      }
    }
  }

  // A dated relationship needs both parties alive when it begins: you cannot
  // marry, nor swear homage, after your death.
  for (const r of record.relationships) {
    const y = r.validTime?.begin?.year;
    if (y === undefined) continue;
    const couple = r.relationshipType === 'couple';
    for (const who of [r.person1, r.person2]) {
      const died = deathYear.get(who.id);
      if (died !== undefined && died < y) {
        findings.push({
          rule: couple
            ? 'spouse-alive-at-marriage'
            : 'parties-alive-when-bond-begins',
          severity: 'error',
          message: couple
            ? `${name(people, who.id)} marries in ${y} after dying in ${died}`
            : `${name(people, who.id)} enters a ${r.relationshipType} bond in ${y} after dying in ${died}`,
          resources: [r.id, who.id],
        });
      }
    }
  }

  return findings;
}

function name(people: Map<string, Person>, id: string): string {
  return people.get(id)?.name ?? id;
}
