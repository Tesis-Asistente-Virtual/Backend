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

/** Validates only TEST_DATABASE_URL. It never reads a general-purpose DB URL as fallback. */
export function validateTestDatabaseUrl(value: string | undefined, nodeEnv = process.env.NODE_ENV): string {
  if (nodeEnv === 'production') throw new TestDatabaseSafetyError('Test database access is disabled when NODE_ENV is production');
  if (!value) throw new TestDatabaseSafetyError('TEST_DATABASE_URL is missing; DATABASE_URL is never used as a fallback');
  let url: URL;
  try { url = new URL(value); } catch { throw new TestDatabaseSafetyError('TEST_DATABASE_URL is malformed'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new TestDatabaseSafetyError('TEST_DATABASE_URL must use postgres: or postgresql:');
  if (url.pathname !== '/tesis_test_db') throw new TestDatabaseSafetyError('TEST_DATABASE_URL must target exactly tesis_test_db');
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!allowedHosts.has(hostname)) throw new TestDatabaseSafetyError('TEST_DATABASE_URL host must be localhost, 127.0.0.1, or ::1');
  return value;
}
