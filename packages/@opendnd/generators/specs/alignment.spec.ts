import { describe, expect, it } from 'bun:test';
import { alignmentCodes } from '@opendnd/types';
import { alignmentAt, alignmentAxes, alignmentDistance } from 'src/alignment';

describe('alignment grid', () => {
  it('has the nine SRD codes, and every one round-trips through its axes', () => {
    expect(alignmentCodes.length).toBe(9);
    for (const code of alignmentCodes) {
      const { order, goodness } = alignmentAxes(code);
      expect(alignmentAt(order, goodness)).toBe(code);
    }
  });

  it('places the corners and the centre', () => {
    expect(alignmentAxes('lawful-good')).toEqual({ order: -1, goodness: 1 });
    expect(alignmentAxes('chaotic-evil')).toEqual({ order: 1, goodness: -1 });
    // The centre is the one code the SRD does not spell as a pair.
    expect(alignmentAxes('neutral')).toEqual({ order: 0, goodness: 0 });
    expect(alignmentAt(0, 0)).toBe('neutral');
    expect(alignmentAt(9, -9)).toBe('chaotic-evil');
  });

  it('measures distance across the grid', () => {
    expect(alignmentDistance('lawful-good', 'chaotic-evil')).toBe(4);
    expect(alignmentDistance('lawful-neutral', 'neutral')).toBe(1);
    expect(alignmentDistance('neutral-good', 'neutral-evil')).toBe(2);
  });
});
