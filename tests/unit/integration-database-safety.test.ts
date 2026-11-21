import { describe, expect, it } from 'vitest';
import { isAllowedLoopbackAddress, validateTestDatabaseUrl } from '../integration/test-database.js';

describe('test PostgreSQL address guard', () => {
  it('accepts IPv4 and IPv6 loopback addresses, including CIDR text forms', () => {
    expect(isAllowedLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isAllowedLoopbackAddress('::1')).toBe(true);
    expect(isAllowedLoopbackAddress('127.0.0.1/32')).toBe(true);
    expect(isAllowedLoopbackAddress('::1/128')).toBe(true);
  });

  it('rejects non-loopback and unexpected CIDR addresses', () => {
    expect(isAllowedLoopbackAddress('192.168.1.10')).toBe(false);
    expect(isAllowedLoopbackAddress('::2')).toBe(false);
    expect(isAllowedLoopbackAddress('::1/64')).toBe(false);
    expect(isAllowedLoopbackAddress('localhost')).toBe(false);
  });
});

describe('test PostgreSQL URL guard', () => {
  it('accepts a local tesis_test_db PostgreSQL URL', () => {
    expect(validateTestDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_test_db'))
      .toBe('postgres://demo:synthetic@localhost:5432/tesis_test_db');
    expect(validateTestDatabaseUrl('postgresql://demo:synthetic@[::1]:5432/tesis_test_db'))
      .toBe('postgresql://demo:synthetic@[::1]:5432/tesis_test_db');
  });

  it('rejects a missing URL without falling back to DATABASE_URL', () => {
    expect(() => validateTestDatabaseUrl(undefined)).toThrow(/TEST_DATABASE_URL is missing/);
  });

  it('rejects a database other than tesis_test_db', () => {
    expect(() => validateTestDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_db'))
      .toThrow(/must target exactly tesis_test_db/);
  });

  it('rejects remote hosts', () => {
    expect(() => validateTestDatabaseUrl('postgres://demo:synthetic@db.example.test:5432/tesis_test_db'))
      .toThrow(/host must be localhost, 127\.0\.0\.1, or ::1/);
  });

  it('rejects malformed URLs', () => {
    expect(() => validateTestDatabaseUrl('not a database URL')).toThrow(/TEST_DATABASE_URL is malformed/);
  });

  it.each(['http:', 'mysql:', 'file:'])('rejects unsupported protocol %s', protocol => {
    expect(() => validateTestDatabaseUrl(`${protocol}//localhost/tesis_test_db`))
      .toThrow(/must use postgres: or postgresql:/);
  });

  it('rejects test database access in production mode', () => {
    expect(() => validateTestDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_test_db', 'production'))
      .toThrow(/disabled when NODE_ENV is production/);
  });
});
