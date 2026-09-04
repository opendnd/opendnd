import { publishAll } from '../outbox';
import { poolFor } from './context';
import { EventBridgeSink } from '../sinks/eventbridge';

/**
 * Drains the outbox onto the event bus.
 *
 * Runs on a schedule rather than on each write, because an event that has to
 * be published inside the transaction that produced it makes the write fail
 * when the bus is unavailable. This way a write only needs the database, and
 * publishing catches up.
 */
export const handler = async (): Promise<{ published: number }> => {
  const busName = process.env.EVENT_BUS_NAME;
  if (!busName) throw new Error('EVENT_BUS_NAME is not set');
  const published = await publishAll(
    await poolFor(),
    new EventBridgeSink(busName),
    Number(process.env.OUTBOX_BATCH ?? 100),
  );
  if (published > 0) console.log(`published ${published} events`);
  return { published };
};
