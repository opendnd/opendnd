import { describe, expect, it } from 'vitest';
import { cellAt } from 'src/schema/cells';
import { displayName, isCountryName, keepCountries } from 'src/schema/names';

describe('isCountryName', () => {
  it("keeps ordinary countries and Côte d'Argeant", () => {
    expect(isCountryName('Beaucourt')).toBe(true);
    expect(isCountryName("Côte d'Argeant")).toBe(true);
    expect(isCountryName('Shadowfell')).toBe(true);
    expect(isCountryName('Felkomp')).toBe(true);
  });

  it('refuses a name that still has a border in it', () => {
    expect(isCountryName('Ce<dur/aNv')).toBe(false);
    expect(isCountryName('east/west')).toBe(false);
  });

  it('refuses readings that are not countries', () => {
    expect(isCountryName('Fell')).toBe(false);
    expect(isCountryName('Veooil')).toBe(false);
  });
});

describe('displayName', () => {
  it('writes Merheim as one word', () => {
    expect(displayName('Mer Heim')).toBe('Merheim');
    expect(displayName('Beaucourt')).toBe('Beaucourt');
  });
});

describe('keepCountries', () => {
  it("gives a misread country's ground to the nearest real one", () => {
    const west = cellAt(2, 5, 9, 6);
    const east = cellAt(2, 6, 9, 6);
    const kept = keepCountries([
      {
        cell: west,
        resource: {
          id: 'beaucourt',
          type: 'kingdom',
          name: 'Beaucourt',
          extent: ['a'],
        },
      },
      {
        cell: east,
        resource: {
          id: 'fell',
          type: 'kingdom',
          name: 'Fell',
          extent: ['b'],
        },
      },
      {
        cell: west,
        resource: { id: 'harbour', type: 'city', name: 'Harbour' },
      },
    ]);
    expect(kept.map((holding) => holding.resource.name)).toEqual([
      'Beaucourt',
      'Harbour',
    ]);
    expect(kept[0]?.resource.extent).toEqual(['a', 'b']);
  });
});
