import type { ModelResponse, Usage } from './message';
import { MICROS_PER_DOLLAR, formatMicros } from './model';

/**
 * The margin added to the cost of a call. OpenDnD recovers its costs and no
 * more; the margin absorbs price changes and payment fees rather than making
 * money.
 */
export const DEFAULT_MARGIN = 0.1;

/**
 * What a call is charged at, given what it cost: rounded up to the
 * micro-dollar. The margin is converted to basis points first so the whole
 * sum is integer arithmetic; `21000 * 1.1` in binary floating point is
 * 23100.000000000004, which rounds up to a micro-dollar that is not owed.
 */
export function chargeFor(costMicros: number, margin = DEFAULT_MARGIN): number {
  const basisPoints = 10_000 + Math.round(margin * 10_000);
  return Math.ceil((costMicros * basisPoints) / 10_000);
}

/** One line of the bill. */
export interface UsageRecord {
  /** ISO 8601 transaction time. */
  readonly at: string;
  readonly task: string;
  readonly model: string;
  readonly provider: string;
  readonly usage: Usage;
  /** What the tokens cost. Zero for a local model or a cache hit. */
  readonly costMicros: number;
  /** What the requester is charged: cost plus the margin. */
  readonly chargeMicros: number;
  readonly cached: boolean;
  /** True when the provider reported no token counts and they were estimated. */
  readonly estimated?: boolean;
  readonly world?: string;
  readonly requestedBy?: string;
}

/** Where usage goes. In the API this writes rows; in a test it holds an array. */
export interface Ledger {
  record(entry: UsageRecord): void | Promise<void>;
}

export class MemoryLedger implements Ledger {
  readonly entries: UsageRecord[] = [];

  record(entry: UsageRecord): void {
    this.entries.push(entry);
  }

  totalCostMicros(): number {
    return this.entries.reduce((sum, e) => sum + e.costMicros, 0);
  }

  totalChargeMicros(): number {
    return this.entries.reduce((sum, e) => sum + e.chargeMicros, 0);
  }

  /** A receipt a person can read. */
  summary(): string {
    const lines = this.entries.map(
      (e) =>
        `${e.task} via ${e.provider}/${e.model}` +
        `${e.cached ? ' (cached)' : ''} ` +
        `${e.usage.inputTokens} in, ${e.usage.outputTokens} out, ` +
        formatMicros(e.chargeMicros) +
        (e.estimated ? ' (estimated)' : ''),
    );
    return [...lines, `total ${formatMicros(this.totalChargeMicros())}`].join(
      '\n',
    );
  }
}

export class BudgetExceededError extends Error {
  constructor(
    readonly limitMicros: number,
    readonly spentMicros: number,
  ) {
    super(
      `budget of ${formatMicros(limitMicros)} is spent (${formatMicros(spentMicros)} used)`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * A ceiling on what one run may spend. It is checked before every call, so a
 * runaway generation stops instead of billing someone.
 */
export class Budget {
  static dollars(amount: number): Budget {
    return new Budget(Math.round(amount * MICROS_PER_DOLLAR));
  }

  private spent = 0;

  constructor(readonly limitMicros: number) {}

  get spentMicros(): number {
    return this.spent;
  }

  get remainingMicros(): number {
    return Math.max(0, this.limitMicros - this.spent);
  }

  /** Throws when nothing is left, before a call is made rather than after. */
  check(): void {
    if (this.remainingMicros <= 0) {
      throw new BudgetExceededError(this.limitMicros, this.spent);
    }
  }

  spend(micros: number): void {
    this.spent += micros;
  }
}

/** The bill line for a completed call. */
export function recordFor(
  response: ModelResponse,
  margin: number,
  extra: { world?: string; requestedBy?: string; estimated?: boolean } = {},
): UsageRecord {
  return {
    at: new Date().toISOString(),
    task: response.task,
    model: response.model,
    provider: response.provider,
    usage: response.usage,
    costMicros: response.costMicros,
    chargeMicros: chargeFor(response.costMicros, margin),
    cached: response.cached,
    ...(extra.estimated ? { estimated: true } : {}),
    ...(extra.world ? { world: extra.world } : {}),
    ...(extra.requestedBy ? { requestedBy: extra.requestedBy } : {}),
  };
}
