import { describe, expect, it } from 'bun:test';
import { versions } from 'src/versions';

describe('versions', () => {
  it('pins a bun version for the packageManager field', () => {
    expect(versions.bun).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
