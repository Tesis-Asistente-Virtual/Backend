import { describe, expect, it } from 'vitest';
import { validateDemoDatabaseUrl } from '../../src/config/demo-database-url.js';

describe('isolated demo database URL guard', () => {
  it('accepts explicit local PostgreSQL URLs for tesis_demo_db', () => {
    expect(validateDemoDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_demo_db'))
      .toBe('postgres://demo:synthetic@localhost:5432/tesis_demo_db');
    expect(validateDemoDatabaseUrl('postgresql://demo:synthetic@[::1]:5432/tesis_demo_db'))
      .toBe('postgresql://demo:synthetic@[::1]:5432/tesis_demo_db');
  });

  it('requires DEMO_DATABASE_URL even if other database variables might exist', () => {
    expect(() => validateDemoDatabaseUrl(undefined)).toThrowError(expect.objectContaining({ code: 'missing_url' }));
  });

  it('rejects any other database name', () => {
    expect(() => validateDemoDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_test_db'))
      .toThrowError(expect.objectContaining({ code: 'wrong_database' }));
    expect(() => validateDemoDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_db'))
      .toThrowError(expect.objectContaining({ code: 'wrong_database' }));
  });

  it('rejects remote hosts and unsupported protocols', () => {
    expect(() => validateDemoDatabaseUrl('postgres://demo:synthetic@db.example.test:5432/tesis_demo_db'))
      .toThrowError(expect.objectContaining({ code: 'non_local_host' }));
    expect(() => validateDemoDatabaseUrl('mysql://demo:synthetic@localhost:3306/tesis_demo_db'))
      .toThrowError(expect.objectContaining({ code: 'unsupported_protocol' }));
  });

  it('rejects malformed URLs and production mode', () => {
    expect(() => validateDemoDatabaseUrl('not a url')).toThrowError(expect.objectContaining({ code: 'invalid_url' }));
    expect(() => validateDemoDatabaseUrl('postgres://demo:synthetic@localhost:5432/tesis_demo_db', 'production'))
      .toThrowError(expect.objectContaining({ code: 'production_mode' }));
  });
});
