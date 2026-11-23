import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/shared/infrastructure/database/schema.js';
import { isAllowedLoopbackAddress, TestDatabaseSafetyError, validateTestDatabaseUrl } from '../../src/shared/infrastructure/database/test-database-safety.js';

export { isAllowedLoopbackAddress, TestDatabaseSafetyError, validateTestDatabaseUrl };

export function getTestDatabaseUrl(): string {
  return validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

export async function connectTestDatabase() {
  const pool = new Pool({ connectionString: getTestDatabaseUrl(), max: 4, connectionTimeoutMillis: 3000, application_name: 'tesis_backend_integration_tests' });
  try {
    const result = await pool.query<{ database_name: string; server_address: string | null }>('SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address');
    const target = result.rows[0];
    if (!target || target.database_name !== 'tesis_test_db') throw new TestDatabaseSafetyError('Connected PostgreSQL database is not tesis_test_db');
    if (!target.server_address || !isAllowedLoopbackAddress(target.server_address)) throw new TestDatabaseSafetyError('Connected PostgreSQL server address is not loopback');
    return { pool, db: drizzle(pool, { schema }) };
  } catch (error) {
    await pool.end();
    if (error instanceof TestDatabaseSafetyError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
      throw new TestDatabaseSafetyError('Could not connect to the configured local PostgreSQL server', 'database_unreachable');
    }
    if (code === '28P01' || code === '3D000') {
      throw new TestDatabaseSafetyError('PostgreSQL rejected the configured test database credentials or database name', code === '28P01' ? 'permission_denied' : 'unknown_database_failure');
    }
    if (code === '42P01' || code === '42703') throw new TestDatabaseSafetyError('PostgreSQL verification query is unavailable', 'schema_missing');
    if (code === '42501') throw new TestDatabaseSafetyError('PostgreSQL denied the test database verification query', 'permission_denied');
    throw new TestDatabaseSafetyError('PostgreSQL connection or test database verification failed', 'unknown_database_failure');
  }
}
