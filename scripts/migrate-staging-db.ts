import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/shared/infrastructure/database/schema.js';
import { isStagingLoopbackAddress, validateStagingDatabaseUrl } from '../src/shared/infrastructure/database/staging-database-safety.js';

const url = validateStagingDatabaseUrl(process.env.STAGING_DATABASE_URL);
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 3000, application_name: 'tesis_staging_migration' });
const db = drizzle(pool, { schema });
try {
  const identity = await pool.query<{ database_name: string; server_address: string | null }>(
    'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
  );
  const target = identity.rows[0];
  if (target?.database_name !== 'tesis_staging_db' || !isStagingLoopbackAddress(target.server_address)) {
    throw new Error('Migration target must be the local tesis_staging_db');
  }
  await migrate(db, { migrationsFolder: './drizzle' });
  process.stdout.write('Applied repository migrations to verified local tesis_staging_db.\n');
} catch (error) {
  if (error instanceof Error && error.message === 'Migration target must be the local tesis_staging_db') throw error;
  throw new Error('Staging migration failed safely; database details were suppressed');
} finally {
  await pool.end();
}
