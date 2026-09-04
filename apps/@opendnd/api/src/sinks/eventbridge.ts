import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import type { EventSink, OutboxEvent } from '../outbox';

/** PutEvents takes at most ten entries per call. */
const BATCH = 10;

/**
 * Publishes the outbox onto an EventBridge bus.
 *
 * A partial failure throws rather than being swallowed: the outbox marks rows
 * published only after the sink returns, so throwing leaves the whole page to
 * be claimed again. Some events are then delivered twice, which a subscriber
 * can be built to tolerate, where a lost event cannot be recovered at all.
 */
export class EventBridgeSink implements EventSink {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly busName: string,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({});
  }

  async publish(events: readonly OutboxEvent[]): Promise<void> {
    for (let start = 0; start < events.length; start += BATCH) {
      const batch = events.slice(start, start + BATCH);
      const result = await this.client.send(
        new PutEventsCommand({ Entries: batch.map((e) => this.entry(e)) }),
      );
      if ((result.FailedEntryCount ?? 0) > 0) {
        const reason = result.Entries?.find((e) => e.ErrorCode)?.ErrorMessage;
        throw new Error(
          `${result.FailedEntryCount} of ${batch.length} events were not accepted: ${reason ?? 'no reason given'}`,
        );
      }
    }
  }

  private entry(event: OutboxEvent): PutEventsRequestEntry {
    return {
      EventBusName: this.busName,
      Source: 'opendnd',
      // The world is the tenant, so a subscriber filters on it by pattern
      // rather than by reading the payload.
      DetailType: String(
        event.envelope.type ?? `${event.model}.${event.action}`,
      ),
      Time: event.occurredAt,
      Resources: [`world/${event.world}`],
      Detail: JSON.stringify({
        ...event.envelope,
        seq: event.seq,
        world: event.world,
        model: event.model,
        id: event.resourceId,
        action: event.action,
      }),
    };
  }
}
