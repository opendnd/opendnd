import { describe, expect, it } from 'vitest';
import {
  ancestor,
  cellAt,
  cellAtLatLng,
  cellModels,
  centerOf,
  commonAncestor,
  contains,
  coverage,
  outlineOf,
  parseCell,
  placeWithin,
  zoomFor,
} from 'src/schema/cells';
import { petOntology } from './fixtures/ontology';

describe('cell tokens', () => {
  it('reads a token back to its face, level and position, and writes it again', () => {
    const cell = cellAt(2, 5, 9, 6);
    expect(parseCell(cell.token)).toEqual(cell);
    expect(parseCell('1')).toEqual({
      token: '1',
      face: 0,
      level: 0,
      i: 0,
      j: 0,
    });
    expect(parseCell('not a cell')).toBeUndefined();
    expect(parseCell(undefined)).toBeUndefined();
  });

  it('knows containment and ancestry', () => {
    const outer = cellAt(2, 5, 9, 6);
    const inner = cellAt(2, 5 * 4 + 3, 9 * 4 + 1, 8);
    expect(contains(outer, inner)).toBe(true);
    expect(contains(inner, outer)).toBe(false);
    expect(contains(outer, cellAt(3, 5, 9, 6))).toBe(false);
    expect(ancestor(inner, 6)).toEqual(outer);
    expect(ancestor(outer, 7)).toBeUndefined();
  });

  it('places a cell inside a focus as a fraction of its side', () => {
    const focus = cellAt(2, 5, 9, 6);
    const inner = cellAt(2, 5 * 4 + 3, 9 * 4 + 1, 8);
    expect(placeWithin(focus, inner)).toEqual({ x: 0.75, y: 0.25, size: 0.25 });
    expect(placeWithin(focus, cellAt(1, 0, 0, 8))).toBeUndefined();
  });

  it('finds the smallest cell holding everything on the busiest face', () => {
    const a = cellAt(2, 5 * 4 + 3, 9 * 4 + 1, 8);
    const b = cellAt(2, 5 * 4 + 0, 9 * 4 + 3, 8);
    const c = cellAt(4, 1, 1, 8);
    expect(commonAncestor([a, b, c])).toEqual(cellAt(2, 5, 9, 6));
    expect(commonAncestor([])).toBeUndefined();
  });

  it('finds the models with a cell field from the schemas', () => {
    expect(cellModels(petOntology())).toEqual([]);
  });
});

describe('cells on the sphere', () => {
  // Reference values from the spatial package's own projection.
  it('finds the cell under a point, the same one the spatial package would', () => {
    expect(cellAtLatLng({ lat: 32, lng: -62 }, 2).token).toBe('95');
    expect(cellAtLatLng({ lat: 24, lng: 88 }, 2).token).toBe('37');
    expect(cellAtLatLng({ lat: -38, lng: 58 }, 4).token).toBe('209');
    expect(cellAtLatLng({ lat: 51.5, lng: -0.12 }, 12).token).toBe('502206f');
  });

  it('puts a cell back on the map at its centre, and outlines it', () => {
    const centre = centerOf(parseCell('95')!);
    expect(centre.lat).toBeCloseTo(29.5328, 3);
    expect(centre.lng).toBeCloseTo(-55.4915, 3);
    // Round trip: the centre of a cell lies in that cell.
    expect(cellAtLatLng(centre, 2).token).toBe('95');
    const outline = outlineOf(parseCell('502206f')!)!;
    expect(outline).toHaveLength(24);
    expect(outline.every((p) => Math.abs(p.lat - 51.5) < 0.1)).toBe(true);
    // A face around a pole has no outline a flat map can draw.
    expect(outlineOf(parseCell('5')!)).toBeUndefined();
    expect(zoomFor(1)).toBe(4);
  });

  it('plans what to fetch for a view: a few sample cells, and the finest level worth drawing', () => {
    const whole = coverage({
      north: 85,
      south: -85,
      east: 180,
      west: -180,
      zoom: 2,
    });
    expect(whole.sampleLevel).toBe(0);
    expect(whole.cells.length).toBeLessThanOrEqual(6);
    expect(whole.maxLevel).toBe(6);
    const close = coverage({
      north: 34,
      south: 30,
      east: -60,
      west: -64,
      zoom: 7,
    });
    expect(close.cells.length).toBeLessThanOrEqual(8);
    expect(close.cells.length).toBeGreaterThan(0);
    expect(close.sampleLevel).toBeGreaterThan(0);
    expect(close.maxLevel).toBe(11);
    // Every sample cell lies on one of the faces reported.
    for (const token of close.cells) {
      expect(close.faces).toContain(ancestor(parseCell(token)!, 0)!.token);
    }
  });

  it('asks whose ground it is standing on a spot, not over a square', () => {
    const close = coverage({
      north: 34,
      south: 30,
      east: -60,
      west: -64,
      zoom: 7,
    });
    expect(close.points.length).toBeGreaterThan(0);
    expect(close.points.length).toBeLessThanOrEqual(8);
    for (const token of close.points) {
      const spot = parseCell(token)!;
      // Finer than anything the view is fetched by, and finer than anything
      // drawn at this zoom: a kingdom holds ground in pieces smaller than a
      // screenful, and a square the size of the screen would miss all of it.
      expect(spot.level).toBeGreaterThan(close.maxLevel);
      expect(spot.level).toBeGreaterThan(close.sampleLevel);
      // And every spot is somewhere in the view.
      expect(
        close.cells.some(
          (cell) =>
            parseCell(cell)!.token ===
            ancestor(spot, parseCell(cell)!.level)!.token,
        ),
      ).toBe(true);
    }
  });
});
