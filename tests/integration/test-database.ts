import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/shared/infrastructure/database/schema.js';

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);

export class TestDatabaseSafetyError extends Error {
  constructor(
    message: string,
    readonly errorKind: 'database_unreachable' | 'schema_missing' | 'permission_denied' | 'unknown_database_failure' = 'unknown_database_failure',
    readonly stage: 'connect' = 'connect',
  ) {
    super(message);
    this.name = 'TestDatabaseSafetyError';
  }
}

export function isAllowedLoopbackAddress(address: string): boolean {
  const normalized = address === '::1/128' ? '::1' : address === '127.0.0.1/32' ? '127.0.0.1' : address;
  return normalized === '127.0.0.1' || normalized === '::1';
}

export function validateTestDatabaseUrl(value: string | undefined, nodeEnv = process.env.NODE_ENV): string {
  if (nodeEnv === 'production') throw new TestDatabaseSafetyError('Test database access is disabled when NODE_ENV is production');
  if (!value) throw new TestDatabaseSafetyError('TEST_DATABASE_URL is missing; DATABASE_URL is never used as a fallback');
  let url: URL;
  try { url = new URL(value); } catch { throw new TestDatabaseSafetyError('TEST_DATABASE_URL is malformed'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new TestDatabaseSafetyError('TEST_DATABASE_URL must use postgres: or postgresql:');
  if (url.pathname !== '/tesis_test_db') throw new TestDatabaseSafetyError('TEST_DATABASE_URL must target exactly tesis_test_db');
  // WHATWG URL preserves IPv6 brackets in hostname (for example, [::1]).
  // Normalize only those parser-added brackets before checking loopback.
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!allowedHosts.has(hostname)) throw new TestDatabaseSafetyError('TEST_DATABASE_URL host must be localhost, 127.0.0.1, or ::1');
  return value;
}

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
