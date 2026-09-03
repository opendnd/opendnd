import { describe, expect, it } from 'bun:test';
import { ONTOLOGY_ID } from 'src';

describe('@opendnd/ontology', () => {
  it('exposes a canonical ontology id', () => {
    expect(ONTOLOGY_ID).toBe('https://opendnd.org/ours/ontology');
  });
});
