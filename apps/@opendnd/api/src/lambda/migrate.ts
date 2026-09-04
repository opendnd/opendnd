import { join } from 'node:path';
import { Pool } from 'pg';
import { APP_ROLE, ensureAppRole, migrate } from '../db';
import { secretString } from '../secrets';

/**
 * Applies the migrations and grants the serving role.
 *
 * Invoked deliberately rather than on deployment: a schema change is not
 * something to have happen as a side effect of shipping code, and the role
 * this runs as is the database owner, which the API itself never uses.
 */
export const handler = async (): Promise<{
  applied: string[];
  role: string;
}> => {
  const arn = process.env.DATABASE_ADMIN_SECRET_ARN;
  if (!arn) throw new Error('DATABASE_ADMIN_SECRET_ARN is not set');
  const url = await secretString(arn, process.env.AWS_REGION);
  if (!url) throw new Error('the admin database secret is empty');

  const pool = new Pool({ connectionString: url });
  try {
    const applied = await migrate(pool, join(__dirname, 'migrations'));
    await ensureAppRole(pool, await appPassword());
    console.log(
      applied.length === 0
        ? 'No migrations to apply.'
        : `Applied ${applied.length}: ${applied.join(', ')}`,
    );
    return { applied, role: APP_ROLE };
  } finally {
    await pool.end();
  }
};

/**
 * The password the serving role should have, taken from the URL the API is
 * given, so the two cannot drift apart.
 */
async function appPassword(): Promise<string | undefined> {
  const arn = process.env.DATABASE_SECRET_ARN;
  if (!arn) return undefined;
  const url = await secretString(arn, process.env.AWS_REGION);
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).password) || undefined;
  } catch {
    return undefined;
  }
}
