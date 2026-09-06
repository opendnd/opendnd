import { describe, expect, it } from 'vitest';
import {
  ancestor,
  cellAt,
  cellModels,
  commonAncestor,
  contains,
  parseCell,
  placeWithin,
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
