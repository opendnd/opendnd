import { describe, expect, it } from 'bun:test';
import { claimByFill, piecesOf, readDrawnMap } from 'src';

/**
 * Two countries painted the same colour, seats in each, and a leftover
 * island of that colour that should go to the nearer seat.
 */
const DRAWING = `<svg width="100" height="100" viewBox="0 0 100 100">
<g id="Land">
<path d="M0 0L30 0L30 30L0 30Z" fill="#9265BA"/>
<path d="M70 70L100 70L100 100L70 100Z" fill="#9265BA"/>
<path d="M85 40L100 40L100 55L85 55Z" fill="#9265BA"/>
<path d="M0 70L20 70L20 100L0 100Z" fill="#B6D1DB"/>
<path d="M40 40L50 40L50 50L40 50Z" fill="white"/>
</g>
</svg>`;

describe('claiming painted land by seat', () => {
  const map = readDrawnMap(DRAWING);

  it('keeps two countries of one colour apart, each named by its seat', () => {
    const { claimed, skipped, unclaimed } = claimByFill(map.shapes, [
      { key: 'west', at: [15, 15] },
      { key: 'east', at: [85, 85] },
    ]);
    expect(skipped).toEqual([]);
    expect(unclaimed).toBe(0);
    expect(claimed.get('west')).toHaveLength(1);
    expect(claimed.get('east')?.length).toBeGreaterThanOrEqual(1);
    expect(claimed.get('west')![0]!.bounds[0]).toBe(0);
    expect(claimed.get('east')!.some((shape) => shape.bounds[0] === 70)).toBe(
      true,
    );
  });

  it('gives an unseated same-colour island to the nearer seat', () => {
    const { claimed } = claimByFill(map.shapes, [
      { key: 'west', at: [15, 15] },
      { key: 'east', at: [85, 85] },
    ]);
    // The small square at (85,40) is closer to the east seat.
    expect(claimed.get('east')!.some((shape) => shape.bounds[1] === 40)).toBe(
      true,
    );
    expect(claimed.get('west')!.some((shape) => shape.bounds[1] === 40)).toBe(
      false,
    );
  });

  it('skips a seat that is in the sea or on ice', () => {
    const sea = claimByFill(map.shapes, [{ key: 'lost', at: [10, 85] }]);
    expect(sea.skipped.some((skip) => skip.key === 'lost')).toBe(true);
    const ice = claimByFill(map.shapes, [{ key: 'ice', at: [45, 45] }]);
    expect(ice.skipped.some((skip) => skip.key === 'ice')).toBe(true);
  });

  it('keeps two seats of one colour when they land on the same region', () => {
    const shared = claimByFill(map.shapes, [
      { key: 'one', at: [10, 10] },
      { key: 'two', at: [20, 20] },
    ]);
    expect(shared.skipped).toEqual([]);
    expect(shared.contested).toHaveLength(1);
    expect([...shared.contested[0]!.keys].sort()).toEqual(['one', 'two']);
    expect(shared.claimed.size).toBeGreaterThanOrEqual(1);
    expect(
      (shared.claimed.get('one')?.length ?? 0) +
        (shared.claimed.get('two')?.length ?? 0),
    ).toBeGreaterThanOrEqual(1);
  });
});

/**
 * A drawing does not hold one path per country. Every piece of one colour is
 * drawn as a single path — two countries, an island and a lake in one `d` —
 * so a claim that worked on paths gave one seat the lot.
 */
const CLASS = `<svg width="100" height="100" viewBox="0 0 100 100">
<g id="Land">
<path d="M0 0L40 0L40 40L0 40ZM10 10L30 10L30 30L10 30ZM60 60L100 60L100 100L60 100Z" fill="#9265BA"/>
</g>
</svg>`;

describe('taking a colour class apart', () => {
  const map = readDrawnMap(CLASS);

  it('finds a region per ring, a ring inside one being a hole in it', () => {
    expect(map.shapes).toHaveLength(1);
    const pieces = piecesOf(map.shapes);
    // Two countries, not three rings and not one path.
    expect(pieces).toHaveLength(2);
    const west = pieces.find((piece) => piece.bounds[0] === 0)!;
    const east = pieces.find((piece) => piece.bounds[0] === 60)!;
    expect(west.rings).toHaveLength(2);
    expect(east.rings).toHaveLength(1);
    // The lake is taken out of the area rather than added to it.
    expect(west.area).toBeCloseTo(40 * 40 - 20 * 20, 5);
    expect(east.area).toBeCloseTo(40 * 40, 5);
  });

  it('gives each seat its own country, and neither the other', () => {
    const { claimed, skipped } = claimByFill(map.shapes, [
      { key: 'west', at: [5, 5] },
      { key: 'east', at: [80, 80] },
    ]);
    expect(skipped).toEqual([]);
    expect(claimed.get('west')).toHaveLength(1);
    expect(claimed.get('east')).toHaveLength(1);
    expect(claimed.get('west')![0]!.bounds[2]).toBe(40);
    expect(claimed.get('east')![0]!.bounds[0]).toBe(60);
  });

  it('leaves a seat in the hole unclaimed, because a lake is not a country', () => {
    const { skipped } = claimByFill(map.shapes, [
      { key: 'lake', at: [20, 20] },
    ]);
    expect(skipped.some((skip) => skip.key === 'lake')).toBe(true);
  });
});
