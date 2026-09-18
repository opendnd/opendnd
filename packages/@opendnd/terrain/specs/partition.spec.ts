import { describe, expect, it } from 'bun:test';
import { CellId } from '@opendnd/spatial';
import {
  claimByFill,
  conflictsOf,
  coveringOf,
  interiorKey,
  partitionOf,
  readDrawnMap,
  regionsOf,
  sharedContests,
  Taken,
  takeLand,
  wholeDrawing,
} from 'src';

/**
 * A small western square painted inside a larger eastern one, and a second
 * seat sitting on the large square's rim — the case a contested stroke is.
 */
const DRAWING = `<svg width="1000" height="1000" viewBox="0 0 1000 1000">
<g id="Land">
<path d="M470 470L530 470L530 530L470 530Z" fill="#bc8d66"/>
<path d="M490 490L510 490L510 510L490 510Z" fill="#f68c6c"/>
</g>
</svg>`;

describe('canonical land ownership', () => {
  const map = readDrawnMap(DRAWING);
  const fit = wholeDrawing(1000, 1000);
  const big = map.shapes[0]!;
  const small = map.shapes[1]!;

  it('gives a contested path to the seat farthest from its edge', () => {
    expect(
      interiorKey(
        big,
        ['rim', 'inside'],
        new Map([
          ['rim', [470, 500] as [number, number]],
          ['inside', [500, 500] as [number, number]],
        ]),
      ),
    ).toBe('inside');
  });

  it("folds a contested path into the interior seat's region", () => {
    const onePath = readDrawnMap(
      `<svg viewBox="0 0 1000 1000"><g id="Land">` +
        `<path d="M400 400L600 400L600 600L400 600Z" fill="#bc8d66"/>` +
        `</g></svg>`,
    );
    const seats = [
      { key: 'rim', at: [402, 500] as [number, number] },
      { key: 'inside', at: [500, 500] as [number, number] },
    ];
    const contested = claimByFill(onePath.shapes, seats);
    expect(contested.contested).toHaveLength(1);
    const regions = regionsOf(contested, seats);
    const inside = regions.find((region) => region.key === 'inside');
    const rim = regions.find((region) => region.key === 'rim');
    expect(inside?.shapes).toHaveLength(1);
    expect(rim).toBeUndefined();
  });

  it('leaves a path shared when two seats both sit inland', () => {
    const onePath = readDrawnMap(
      `<svg viewBox="0 0 1000 1000"><g id="Land">` +
        `<path d="M200 200L800 200L800 800L200 800Z" fill="#bc8d66"/>` +
        `</g></svg>`,
    );
    const seats = [
      { key: 'west', at: [350, 500] as [number, number] },
      { key: 'east', at: [650, 500] as [number, number] },
    ];
    const contested = claimByFill(onePath.shapes, seats);
    expect(sharedContests(contested, seats)).toHaveLength(1);
    expect(regionsOf(contested, seats).flatMap((region) => region.shapes)).toHaveLength(
      0,
    );
  });

  it('keeps no cell in two countries, and no country inside another', () => {
    const regions = [
      { key: 'west', shapes: [small], area: small.area },
      { key: 'east', shapes: [big], area: big.area },
    ];
    const holdings = partitionOf(regions, fit, {
      minLevel: 6,
      maxLevel: 10,
      most: 400,
    });
    expect(conflictsOf(holdings)).toEqual([]);
    const west = holdings.get('west') ?? [];
    const east = holdings.get('east') ?? [];
    expect(west.length).toBeGreaterThan(0);
    expect(east.length).toBeGreaterThan(0);
    const covered = coveringOf(small, fit, {
      minLevel: 6,
      maxLevel: 10,
      most: 400,
    });
    expect(west.length).toBe(covered.length);
    expect(
      east.some((token) =>
        covered.some((own) => {
          const a = CellId.fromToken(token);
          const b = CellId.fromToken(own);
          return a.contains(b) || b.contains(a) || a.equals(b);
        }),
      ),
    ).toBe(false);
  });

  it('carves a coarse cell so a finer neighbour keeps its square', () => {
    const taken = new Taken();
    const parent = CellId.fromFaceIJ(0, 0, 0, 4);
    const child = parent.children()[0]!;
    taken.add(child.token());
    const kept = takeLand([parent.token()], taken, 8);
    expect(kept).not.toContain(parent.token());
    expect(kept).not.toContain(child.token());
    expect(kept.length).toBeGreaterThan(0);
    expect(
      kept.every((token) => {
        const cell = CellId.fromToken(token);
        return parent.contains(cell) && !child.contains(cell) && !cell.equals(child);
      }),
    ).toBe(true);
  });
});
