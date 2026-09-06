import type { Ledger, UsageRecord } from '@opendnd/llm';
import type { PoolClient } from 'pg';

/**
 * The usage ledger, written to `model_usage` inside the request's own
 * transaction, so a call that is rolled back leaves no bill behind and a
 * call that lands is charged in the same commit that keeps its output.
 *
 * The world and the caller come from the request rather than from the line,
 * since the line was made by a library that knows neither.
 */
export class PgLedger implements Ledger {
  /** The last line written, for the response to show what the call cost. */
  last: UsageRecord | undefined;

  constructor(
    private readonly client: PoolClient,
    private readonly world: string,
    private readonly subject: string | undefined,
  ) {}

  async record(entry: UsageRecord): Promise<void> {
    this.last = entry;
    await this.client.query(
      `insert into model_usage
         (world_id, user_id, task, model, provider, input_tokens, output_tokens,
          cost_micros, charge_micros, cached, estimated, at)
       values ($1, (select id from app_user where subject = $2), $3, $4, $5,
               $6, $7, $8, $9, $10, $11, $12)`,
      [
        this.world,
        this.subject ?? null,
        entry.task,
        entry.model,
        entry.provider,
        entry.usage.inputTokens,
        entry.usage.outputTokens,
        entry.costMicros,
        entry.chargeMicros,
        entry.cached,
        entry.estimated ?? false,
        entry.at,
      ],
    );
  }
}
