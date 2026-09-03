import { describe, expect, it } from 'bun:test';
import type { Event, Person, Tenure } from '@opendnd/types';
import { checkHistory } from 'src';

const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
const trs = 'c0000000-0000-4000-8000-000000000001';
const now = '2026-09-03T12:00:00Z';
const recorded = { createdAt: now, updatedAt: now, revision: 1 };
const person = (
  id: string,
  name: string,
  born: number,
  died?: number,
): Person => ({
  id,
  world,
  name,
  canonStatus: 'canon',
  perspective: 'in-universe',
  recorded,
  status: died === undefined ? 'alive' : 'dead',
  birth: { time: { trs, year: born, precision: 'year' } },
  ...(died === undefined
    ? {}
    : { death: { time: { trs, year: died, precision: 'year' } } }),
});
const event = (
  id: string,
  type: Event['eventType'],
  year: number,
  participants: Array<[string, string]>,
): Event => ({
  id,
  world,
  name: `${type} ${year}`,
  canonStatus: 'canon',
  perspective: 'in-universe',
  recorded,
  eventType: type,
  when: { begin: { trs, year, precision: 'year' } },
  participants: participants.map(([pid, role]) => ({
    actor: { model: 'person', id: pid },
    role,
  })),
});

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';
const C = 'a0000000-0000-4000-8000-000000000003';

describe('checkHistory', () => {
  it('flags participation after death', () => {
    const findings = checkHistory({
      people: [person(A, 'Alaric', 1000, 1050), person(B, 'Berta', 1010)],
      relationships: [],
      events: [
        event('e1', 'death', 1050, [[A, 'deceased']]),
        event('e2', 'marriage', 1055, [
          [A, 'spouse'],
          [B, 'spouse'],
        ]),
      ],
      tenures: [],
    });
    expect(findings.map((f) => f.rule)).toEqual([
      'no-posthumous-participation',
    ]);
    expect(findings[0].resources).toEqual(['e2', A]);
  });

  it('flags a death year that disagrees between event and record', () => {
    const findings = checkHistory({
      people: [person(A, 'Alaric', 1000, 1050)],
      relationships: [],
      events: [event('e1', 'death', 1048, [[A, 'deceased']])],
      tenures: [],
    });
    expect(findings.map((f) => f.rule)).toContain('death-year-agrees');
  });

  it('flags overlapping tenures and holders past their death', () => {
    const tenure = (
      id: string,
      holder: string,
      begin: number,
      end?: number,
    ): Tenure => ({
      id,
      world,
      name: id,
      canonStatus: 'canon',
      perspective: 'in-universe',
      recorded,
      office: { model: 'office', id: 'o1', name: 'Lord' },
      holder: { model: 'person', id: holder },
      validTime: {
        begin: { trs, year: begin, precision: 'year' },
        ...(end === undefined
          ? {}
          : { end: { trs, year: end, precision: 'year' } }),
      },
    });
    const findings = checkHistory({
      people: [
        person(A, 'Alaric', 1000, 1050),
        person(B, 'Berta', 1010),
        person(C, 'Cai', 1020),
      ],
      relationships: [],
      events: [],
      tenures: [tenure('t1', A, 1020, 1060), tenure('t2', B, 1055)],
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('holder-alive-during-tenure');
    expect(rules).toContain('one-holder-at-a-time');
  });

  it('flags a birth to a dead or under-age parent', () => {
    const findings = checkHistory({
      people: [
        person(A, 'Alaric', 1000, 1030),
        person(B, 'Berta', 1020),
        person(C, 'Cai', 1033),
      ],
      relationships: [],
      events: [
        event('e1', 'birth', 1033, [
          [C, 'child'],
          [B, 'mother'],
          [A, 'father'],
        ]),
      ],
      tenures: [],
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('parent-alive-at-birth');
  });

  it('is silent on a clean record', () => {
    const findings = checkHistory({
      people: [person(A, 'Alaric', 1000, 1050), person(B, 'Berta', 1010)],
      relationships: [],
      events: [
        event('e1', 'marriage', 1030, [
          [A, 'spouse'],
          [B, 'spouse'],
        ]),
        event('e2', 'death', 1050, [
          [A, 'deceased'],
          [B, 'widowed'],
        ]),
      ],
      tenures: [],
    });
    expect(findings).toEqual([]);
  });
});
