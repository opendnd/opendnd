import { describe, expect, it } from 'bun:test';
import { alignmentCodes } from '@opendnd/types';
import { alignmentAt, alignmentAxes, alignmentDistance } from 'src/alignment';

describe('alignment matrix', () => {
  it('has 25 codes that round-trip through their axes', () => {
    expect(alignmentCodes.length).toBe(25);
    for (const code of alignmentCodes) {
      const { order, goodness } = alignmentAxes(code);
      expect(alignmentAt(order, goodness)).toBe(code);
    }
  });

  it('places the corners and the centre', () => {
    expect(alignmentAxes('lawful-good')).toEqual({ order: -2, goodness: 2 });
    expect(alignmentAxes('chaotic-evil')).toEqual({ order: 2, goodness: -2 });
    expect(alignmentAxes('true-neutral')).toEqual({ order: 0, goodness: 0 });
    expect(alignmentAt(0, 0)).toBe('true-neutral');
    expect(alignmentAt(9, -9)).toBe('chaotic-evil');
  });

  it('measures distance across the grid', () => {
    expect(alignmentDistance('lawful-good', 'chaotic-evil')).toBe(8);
    expect(alignmentDistance('social-moral', 'true-neutral')).toBe(2);
  });
});
