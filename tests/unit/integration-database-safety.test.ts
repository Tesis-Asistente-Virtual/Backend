import { describe, expect, it } from 'vitest';
import { isAllowedLoopbackAddress } from '../integration/test-database.js';

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
