import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/shared/infrastructure/database/schema.js';

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
export function isAllowedLoopbackAddress(address: string): boolean {
  const normalized = address === '::1/128' ? '::1' : address === '127.0.0.1/32' ? '127.0.0.1' : address;
  return normalized === '127.0.0.1' || normalized === '::1';
}
export function getTestDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Integration tests are disabled in production');
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; no fallback is permitted');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('TEST_DATABASE_URL must use PostgreSQL');
  if (url.pathname !== '/tesis_test_db') throw new Error('Integration tests require database tesis_test_db');
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error('Integration tests allow only a local PostgreSQL host');
  return value;
}

export async function connectTestDatabase() {
  const pool = new Pool({ connectionString: getTestDatabaseUrl(), max: 4, connectionTimeoutMillis: 3000, application_name: 'tesis_backend_integration_tests' });
  try {
    const result = await pool.query<{ database_name: string; server_address: string | null }>('SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address');
    const target = result.rows[0];
    if (!target || target.database_name !== 'tesis_test_db' || !target.server_address || !isAllowedLoopbackAddress(target.server_address)) {
      throw new Error('Connected PostgreSQL server could not be verified as local tesis_test_db');
    }
    return { pool, db: drizzle(pool, { schema }) };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
