import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/shared/infrastructure/database/schema.js';
import { isStagingLoopbackAddress, validateStagingDatabaseUrl } from '../src/shared/infrastructure/database/staging-database-safety.js';
import { ensureIntegratedStagingSyntheticNotices } from '../src/staging/synthetic-consent-fixtures.js';

const url = validateStagingDatabaseUrl(process.env.STAGING_DATABASE_URL);
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 3000, application_name: 'tesis_staging_synthetic_notice_seed' });
const db = drizzle(pool, { schema });
try {
  const identity = await pool.query<{ database_name: string; server_address: string | null }>(
    'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
  );
  const target = identity.rows[0];
  if (target?.database_name !== 'tesis_staging_db' || !isStagingLoopbackAddress(target.server_address)) {
    throw new Error('Fixture target must be the local tesis_staging_db');
  }
  const notices = await ensureIntegratedStagingSyntheticNotices(db);
  process.stdout.write(`Verified synthetic staging notices for ${Object.keys(notices).length} independent consent purposes.\n`);
} catch (error) {
  if (error instanceof Error && error.message === 'Fixture target must be the local tesis_staging_db') throw error;
  throw new Error('Synthetic staging notice setup failed safely; database details were suppressed');
} finally {
  await pool.end();
}
