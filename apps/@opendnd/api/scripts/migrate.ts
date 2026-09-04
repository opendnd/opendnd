import { join } from 'node:path';
import { APP_ROLE, createAdminPool, ensureAppRole, migrate } from '../src/db';

const pool = createAdminPool();
try {
  const applied = await migrate(pool, join(__dirname, '..', 'migrations'));
  console.log(
    applied.length === 0
      ? 'No migrations to apply.'
      : `Applied ${applied.length}: ${applied.join(', ')}`,
  );
  await ensureAppRole(pool);
  console.log(`Granted ${APP_ROLE} access to every table.`);
} finally {
  await pool.end();
}
