import type { Pool } from 'pg';
import { inWorld } from './db';

/** One write, ready to publish. */
export interface OutboxEvent {
  readonly seq: string;
  readonly world: string;
  readonly model: string;
  readonly resourceId: string;
  readonly action: string;
  readonly envelope: Record<string, unknown>;
  readonly occurredAt: Date;
}

/** Where published events go. EventBridge in a deployment; a list in a test. */
export interface EventSink {
  publish(events: readonly OutboxEvent[]): Promise<void>;
}

/**
 * Publish what the outbox holds for one world.
 *
 * The rows are claimed with `for update skip locked`, so several publishers
 * can run at once without one waiting on another or two sending the same
 * event. Marking them published happens in the same transaction as the claim,
 * and the sink is called inside it: a sink that throws leaves the rows
 * unpublished to be picked up again, which is the failure worth having. The
 * cost is that an event can be delivered twice, so a subscriber has to
 * tolerate that, which is cheaper than losing one.
 */
export async function publishWorld(
  pool: Pool,
  world: string,
  sink: EventSink,
  limit = 100,
): Promise<number> {
  return inWorld(pool, world, async (client) => {
    const { rows } = await client.query<{
      seq: string;
      world_id: string;
      model: string;
      resource_id: string;
      action: string;
      envelope: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select seq, world_id, model, resource_id, action, envelope, occurred_at
       from event_outbox
       where published_at is null
       order by seq
       limit $1
       for update skip locked`,
      [limit],
    );
    if (rows.length === 0) return 0;

    await sink.publish(
      rows.map((r) => ({
        seq: r.seq,
        world: r.world_id,
        model: r.model,
        resourceId: r.resource_id,
        action: r.action,
        envelope: r.envelope,
        occurredAt: r.occurred_at,
      })),
    );

    await client.query(
      'update event_outbox set published_at = now() where seq = any($1::bigint[])',
      [rows.map((r) => r.seq)],
    );
    return rows.length;
  });
}

/**
 * The worlds with events waiting.
 *
 * This runs outside any world, so it reads the table directly rather than
 * through the policies; it returns only ids and counts, never content.
 */
export async function worldsWithPending(
  pool: Pool,
  limit = 100,
): Promise<{ world: string; pending: number }[]> {
  const { rows } = await pool.query<{ world: string; pending: string }>(
    `select world_id as world, count(*) as pending
     from event_outbox
     where published_at is null
     group by world_id
     order by min(seq)
     limit $1`,
    [limit],
  );
  return rows.map((r) => ({ world: r.world, pending: Number(r.pending) }));
}

/** Publish for every world that has anything waiting. */
export async function publishAll(
  pool: Pool,
  sink: EventSink,
  perWorld = 100,
): Promise<number> {
  let published = 0;
  for (const { world } of await worldsWithPending(pool)) {
    published += await publishWorld(pool, world, sink, perWorld);
  }
  return published;
}

/** Writes each event to the console. The local stand-in for a bus. */
export class LoggingSink implements EventSink {
  readonly published: OutboxEvent[] = [];

  async publish(events: readonly OutboxEvent[]): Promise<void> {
    for (const event of events) {
      this.published.push(event);
      console.log(
        `${event.envelope.type ?? `${event.model}.${event.action}`} ` +
          `${event.world}/${event.model}/${event.resourceId}`,
      );
    }
  }
}
