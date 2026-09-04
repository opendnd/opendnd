import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Budget,
  BudgetExceededError,
  FileCache,
  MemoryLedger,
  canonicalJson,
  chargeFor,
  formatMicros,
} from 'src';
import type { ModelResponse } from 'src';

const response: ModelResponse = {
  task: 'chronicle',
  model: 'test-hosted',
  provider: 'hosted',
  modelId: 'hosted-test',
  text: 'Aerath endures.',
  usage: { inputTokens: 10, outputTokens: 4 },
  stopReason: 'stop',
  costMicros: 90,
  cached: false,
  promptHash: 'abc123',
};

describe('FileCache', () => {
  it('keeps a reply across processes, one file per key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'opendnd-llm-'));
    const cache = new FileCache(directory);
    expect(await cache.get('abc123')).toBeUndefined();
    await cache.set('abc123', response);
    expect(await new FileCache(directory).get('abc123')).toEqual(response);
  });
});

describe('canonicalJson', () => {
  it('does not care what order the keys came in', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(
      '{"a":[2,{"c":3,"d":4}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('treats an absent field and an undefined one as the same thing', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe('money', () => {
  it('adds the margin without inventing a micro-dollar', () => {
    expect(chargeFor(21000)).toBe(23100);
    expect(chargeFor(0)).toBe(0);
    expect(chargeFor(1)).toBe(2); // a part micro-dollar rounds up
    expect(chargeFor(1000, 0)).toBe(1000);
    expect(chargeFor(1000, 0.25)).toBe(1250);
  });

  it('prints micro-dollars as money', () => {
    expect(formatMicros(0)).toBe('$0.000000');
    expect(formatMicros(1)).toBe('$0.000001');
    expect(formatMicros(4_500_000)).toBe('$4.500000');
    expect(formatMicros(12_345_678)).toBe('$12.345678');
  });

  it('counts down a budget and says when it is spent', () => {
    const budget = Budget.dollars(1);
    expect(budget.limitMicros).toBe(1_000_000);
    budget.check();
    budget.spend(600_000);
    expect(budget.remainingMicros).toBe(400_000);
    budget.check();
    budget.spend(400_000);
    expect(budget.remainingMicros).toBe(0);
    expect(() => budget.check()).toThrow(BudgetExceededError);
  });

  it('adds up a run', () => {
    const ledger = new MemoryLedger();
    ledger.record({
      at: '2026-09-04T00:00:00Z',
      task: 'chronicle',
      model: 'm',
      provider: 'p',
      usage: { inputTokens: 1, outputTokens: 1 },
      costMicros: 100,
      chargeMicros: 110,
      cached: false,
    });
    ledger.record({
      at: '2026-09-04T00:00:01Z',
      task: 'chronicle',
      model: 'm',
      provider: 'p',
      usage: { inputTokens: 1, outputTokens: 1 },
      costMicros: 0,
      chargeMicros: 0,
      cached: true,
    });
    expect(ledger.totalCostMicros()).toBe(100);
    expect(ledger.totalChargeMicros()).toBe(110);
    expect(ledger.summary()).toContain('(cached)');
  });
});
