/**
 * What a model costs, in US dollars per million tokens. These are
 * configuration, not facts: check them against the provider's current price
 * list before charging anyone. Local models have no pricing and cost nothing.
 */
export interface Pricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/**
 * What a model can do beyond returning text. Advisory only: it is shown to
 * whoever chooses a model and never rules one out for them.
 */
export type Capability = 'schema' | 'tools' | 'vision' | 'embedding';

/**
 * What is known about one model: a stable name for it, the provider that
 * serves it, and the limits and price whoever picks it should see.
 */
export interface ModelSpec {
  /** Name used in configuration and in calls, e.g. `claude-sonnet`. */
  readonly id: string;
  /** Id of the provider that serves it. */
  readonly provider: string;
  /** The provider's own identifier, e.g. `anthropic.claude-sonnet-4-5-20250929-v1:0`. */
  readonly modelId: string;
  /** Absent when the limit is not known; a prompt is then not checked against it. */
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  /** What the model can do beyond text, for a model picker. */
  readonly capabilities: readonly Capability[];
  /** Absent means free at the point of use: a model on the user's own machine. */
  readonly pricing?: Pricing;
}

/** Millionths of a dollar, so money is only ever added as integers. */
export const MICROS_PER_DOLLAR = 1_000_000;

/** What a call cost, rounded up to the micro-dollar. */
export function costOf(
  spec: ModelSpec,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): number {
  if (!spec.pricing) return 0;
  const { inputPerMillion, outputPerMillion } = spec.pricing;
  const dollars =
    (usage.inputTokens * inputPerMillion +
      usage.outputTokens * outputPerMillion) /
    1_000_000;
  return Math.ceil(dollars * MICROS_PER_DOLLAR);
}

export function hasCapability(spec: ModelSpec, needed: Capability): boolean {
  return spec.capabilities.includes(needed);
}

/** Format micro-dollars for a receipt: 1234567 becomes `$1.234567`. */
export function formatMicros(micros: number): string {
  const sign = micros < 0 ? '-' : '';
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / MICROS_PER_DOLLAR);
  const frac = String(abs % MICROS_PER_DOLLAR).padStart(6, '0');
  return `${sign}$${whole}.${frac}`;
}
