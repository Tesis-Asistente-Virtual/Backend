import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getDemoDatabaseUrl } from '../src/config/demo-database-url.js';
import * as schema from '../src/shared/infrastructure/database/schema.js';

export class DemoDatabaseConnectionError extends Error {
  constructor(readonly errorKind: 'database_unreachable' | 'wrong_database' | 'non_local_server' | 'permission_denied' | 'unknown_database_failure') {
    super('Demo database connection could not be verified safely');
    this.name = 'DemoDatabaseConnectionError';
  }
}

function isLoopback(address: string | null): boolean {
  return address === '127.0.0.1' || address === '::1';
}

export async function connectDemoDatabase() {
  const pool = new Pool({
    connectionString: getDemoDatabaseUrl(),
    max: 4,
    connectionTimeoutMillis: 3_000,
    application_name: 'tesis_backend_isolated_demo',
  });
  try {
    const result = await pool.query<{ database_name: string; server_address: string | null }>(
      'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
    );
    const target = result.rows[0];
    if (!target || target.database_name !== 'tesis_demo_db') throw new DemoDatabaseConnectionError('wrong_database');
    if (!isLoopback(target.server_address)) throw new DemoDatabaseConnectionError('non_local_server');
    return { pool, db: drizzle(pool, { schema }) };
  } catch (error) {
    await pool.end();
    if (error instanceof DemoDatabaseConnectionError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || (typeof code === 'string' && code.startsWith('08'))) {
      throw new DemoDatabaseConnectionError('database_unreachable');
    }
    if (code === '28P01' || code === '42501') throw new DemoDatabaseConnectionError('permission_denied');
    throw new DemoDatabaseConnectionError('unknown_database_failure');
  }
}
