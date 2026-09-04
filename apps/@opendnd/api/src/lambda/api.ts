import { handle } from 'hono/aws-lambda';
import { appFor } from './context';

/**
 * The API on Lambda.
 *
 * The same Hono app the local server runs. Hono's handler is built from a
 * `fetch` function, so there is no separate Lambda variant of any route and
 * nothing can behave differently in a deployment than it does on a machine.
 */
export const handler = async (
  event: Parameters<ReturnType<typeof handle>>[0],
  context: Parameters<ReturnType<typeof handle>>[1],
): Promise<unknown> => handle(await appFor())(event, context);
