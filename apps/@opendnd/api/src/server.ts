import { createApp } from './app';
import { createPool } from './db';
import { resolverFromEnv } from './identity';

const pool = createPool();
const identity = resolverFromEnv();
const port = Number(process.env.PORT ?? 4080);

if (!identity) {
  console.warn(
    'No identity provider is configured, so every request is anonymous and ' +
      'nothing can be saved. Set COGNITO_USER_POOL_ID and ' +
      'COGNITO_CLIENT_IDS, or OPENDND_DEV_AUTH=on to work without a pool.',
  );
}

const app = createApp({ pool, ...(identity ? { identity } : {}) });

console.log(`OpenDnD API on http://localhost:${port}`);

export default { port, fetch: app.fetch };
