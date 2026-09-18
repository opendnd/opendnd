/**
 * What a political map will treat as a country's name.
 *
 * Labels were read off the painted map. A slash or angle bracket is the
 * recogniser making a word out of a border tick, not a place, and a few
 * readings are known not to be countries at all.
 */

import { centerOf, type Cell } from './cells';

const DISPLAY: Readonly<Record<string, string>> = {
  'Mer Heim': 'Merheim',
};

const NOT_A_COUNTRY = new Set(['fell', 'veooil']);

export function isCountryName(name: unknown): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (/[<>/]/.test(name)) return false;
  return !NOT_A_COUNTRY.has(name.trim().toLowerCase());
}

export function displayName(name: string): string {
  return DISPLAY[name] ?? name;
}

export interface NamedHolding {
  readonly cell: Cell;
  readonly resource: {
    readonly id?: unknown;
    readonly type?: unknown;
    readonly name?: unknown;
    readonly extent?: unknown;
  };
}

/**
 * Drop misread countries, and give the ground they were holding to the
 * nearest real one. Leaving the cells empty would punch holes; drawing them
 * under a fake name would keep Fell on the map.
 */
export function keepCountries<T extends NamedHolding>(
  holdings: readonly T[],
): T[] {
  const real: T[] = [];
  const junk: T[] = [];
  for (const holding of holdings) {
    if (
      holding.resource.type === 'kingdom' &&
      !isCountryName(holding.resource.name)
    ) {
      junk.push(holding);
    } else {
      real.push(holding);
    }
  }
  if (junk.length === 0) return real;
  const kingdoms = real.filter(
    (holding) => holding.resource.type === 'kingdom',
  );
  if (kingdoms.length === 0) return real;
  const extra = new Map<string, string[]>();
  for (const fake of junk) {
    const extent = Array.isArray(fake.resource.extent)
      ? fake.resource.extent.map(String)
      : [];
    if (extent.length === 0) continue;
    const at = centerOf(fake.cell);
    let nearest = kingdoms[0]!;
    let closest = Infinity;
    for (const kingdom of kingdoms) {
      const seat = centerOf(kingdom.cell);
      const dlat = seat.lat - at.lat;
      const dlng = seat.lng - at.lng;
      const away = dlat * dlat + dlng * dlng;
      if (away < closest) {
        closest = away;
        nearest = kingdom;
      }
    }
    const key = String(nearest.resource.id ?? '');
    extra.set(key, [...(extra.get(key) ?? []), ...extent]);
  }
  return real.map((holding) => {
    const more = extra.get(String(holding.resource.id ?? ''));
    if (!more) return holding;
    const had = Array.isArray(holding.resource.extent)
      ? holding.resource.extent.map(String)
      : [];
    return {
      ...holding,
      resource: { ...holding.resource, extent: [...had, ...more] },
    };
  });
}
