import { describe, expect, it } from 'vitest';
import { describe as describeSchema } from 'src/schema/fields';
import {
  formatPosition,
  formatSpan,
  isPosition,
  isSpan,
  isTimeField,
  summaryFields,
  yearsOf,
} from 'src/schema/time';
import { petOntology } from './fixtures/ontology';

const trs = 'c0000000-0000-4000-8000-000000000001';

describe('in-world time, read by shape', () => {
  it('tells a position and a span from other objects', () => {
    expect(isPosition({ trs, year: 1030 })).toBe(true);
    expect(isPosition({ trs, nominal: 'the Age of Ash' })).toBe(true);
    expect(isPosition({ trs })).toBe(false);
    expect(isPosition({ year: 1030 })).toBe(false);
    expect(isSpan({ begin: { trs, year: 1030 } })).toBe(true);
    expect(isSpan({ begin: { trs, year: 1030 }, place: 'x' })).toBe(false);
    expect(isSpan({})).toBe(false);
  });

  it('reads as years, with the month and day when given and about when rough', () => {
    expect(formatPosition({ trs, year: 1030 })).toBe('1030');
    expect(formatPosition({ trs, year: 1030, month: 3, day: 12 })).toBe(
      '1030, month 3, day 12',
    );
    expect(formatPosition({ trs, year: 1000, precision: 'century' })).toBe(
      'about 1000',
    );
    expect(formatPosition({ trs, nominal: 'the Age of Ash' })).toBe(
      'the Age of Ash',
    );
    expect(
      formatSpan({ begin: { trs, year: 1030 }, end: { trs, year: 1035 } }),
    ).toBe('1030 to 1035');
    expect(
      formatSpan({ begin: { trs, year: 1030 }, end: { trs, year: 1030 } }),
    ).toBe('1030');
    expect(formatSpan({ end: { trs, year: 1035 } })).toBe('until 1035');
    expect(
      formatSpan({
        earliest: { trs, year: 1030 },
        latest: { trs, year: 1040 },
      }),
    ).toBe('between 1030 and 1040');
  });

  it('knows the years a time covers', () => {
    expect(yearsOf({ trs, year: 1030 })).toEqual({ from: 1030, to: 1030 });
    expect(
      yearsOf({ begin: { trs, year: 1030 }, latest: { trs, year: 1041 } }),
    ).toEqual({ from: 1030, to: 1041 });
    expect(yearsOf({ trs, nominal: 'long ago' })).toBeUndefined();
  });

  it('picks the fields of a model that fit in a cell, in schema order', () => {
    const ontology = petOntology();
    const root = describeSchema(ontology.schema('pet')!, ontology, {
      name: 'pet',
    });
    expect(summaryFields(root).map((f) => f.name)).toEqual([
      'mood',
      'colour',
      'legs',
    ]);
    expect(summaryFields(root, 8).map((f) => f.name)).toEqual([
      'mood',
      'colour',
      'legs',
      'weight',
      'friendly',
      'born',
      'seen',
    ]);
    const born = root.fields!.find((f) => f.name === 'born')!;
    expect(isTimeField(born)).toBe(true);
    expect(isTimeField(root.fields!.find((f) => f.name === 'home')!)).toBe(
      false,
    );
  });
});
