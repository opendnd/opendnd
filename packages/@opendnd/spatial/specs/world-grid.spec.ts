import { describe, expect, it } from 'bun:test';
import { Rng } from '@opendnd/random';
import { CellId, EARTH_RADIUS_METERS, WorldGrid, levelForEdge } from 'src';

const rng = new Rng('grid');
const randomLatLng = () => ({
  lat: rng.next() * 180 - 90,
  lng: rng.next() * 360 - 180,
});

describe('WorldGrid', () => {
  const earth = new WorldGrid({ radiusMeters: EARTH_RADIUS_METERS });

  it('puts a 5-foot square at level 22 or 23 on an Earth-sized world', () => {
    expect([22, 23]).toContain(earth.squareLevel);
    expect(earth.edgeMeters(earth.squareLevel)).toBeGreaterThan(0.9);
    expect(earth.edgeMeters(earth.squareLevel)).toBeLessThan(2.5);
    expect(earth.tileLevel).toBe(earth.squareLevel - 6);
  });

  it('picks coarser square levels for smaller worlds', () => {
    const moon = new WorldGrid({ radiusMeters: 1_737_000 });
    expect(moon.squareLevel).toBeLessThanOrEqual(earth.squareLevel);
    expect(levelForEdge(EARTH_RADIUS_METERS, 1000)).toBeLessThan(
      levelForEdge(EARTH_RADIUS_METERS, 1),
    );
  });

  it('addresses every square uniquely inside its 64x64 tile', () => {
    for (let k = 0; k < 100; k++) {
      const ll = randomLatLng();
      const square = earth.squareAt(ll);
      const { tile, x, y } = earth.squareInTile(square);
      expect(tile.equals(earth.tileAt(ll))).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(64);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(64);
      expect(earth.squareOf(tile, x, y).equals(square)).toBe(true);
    }
  });

  it('a tile holds exactly tileSquares squared squares', () => {
    const tile = earth.tileAt({ lat: 51.5, lng: -0.12 });
    const seen = new Set<string>();
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) seen.add(earth.squareOf(tile, x, y).token());
    }
    expect(seen.size).toBe(64 * 64);
    for (const t of seen) expect(tile.contains(CellId.fromToken(t))).toBe(true);
  });

  it('rejects impossible options', () => {
    expect(
      () =>
        new WorldGrid({ radiusMeters: EARTH_RADIUS_METERS, tileSquares: 48 }),
    ).toThrow(RangeError);
    expect(
      () => new WorldGrid({ radiusMeters: 10, tileSquares: 1 << 20 }),
    ).toThrow(RangeError);
  });
});
