import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CorsConfigurationError, parseCorsAllowedOrigins } from '../../src/config/cors.js';
import { createCorsMiddleware } from '../../src/shared/infrastructure/http/cors-middleware.js';

function harness(input: {
  readonly method?: string;
  readonly origin?: string;
  readonly requestMethod?: string;
  readonly requestHeaders?: string;
}, allowedOrigins: readonly string[]) {
  const requestHeaders = new Map<string, string>();
  if (input.origin !== undefined) requestHeaders.set('origin', input.origin);
  if (input.requestMethod !== undefined) requestHeaders.set('access-control-request-method', input.requestMethod);
  if (input.requestHeaders !== undefined) requestHeaders.set('access-control-request-headers', input.requestHeaders);
  const req = {
    method: input.method ?? 'GET',
    get: (name: string) => requestHeaders.get(name.toLowerCase()),
  } as unknown as Request;

  const writtenHeaders = new Map<string, string>();
  let statusCode = 200;
  const res = {
    vary: vi.fn((name: string) => { writtenHeaders.set('vary', name); }),
    set: vi.fn((name: string, value: string) => { writtenHeaders.set(name.toLowerCase(), value); }),
    status: vi.fn((status: number) => { statusCode = status; return res; }),
    end: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  createCorsMiddleware(allowedOrigins)(req, res, next);
  return { headers: writtenHeaders, statusCode: () => statusCode, next, res };
}

describe('CORS configuration', () => {
  it('denies cross-origin access by default when unset or empty', () => {
    expect(parseCorsAllowedOrigins(undefined)).toEqual([]);
    expect(parseCorsAllowedOrigins('  ')).toEqual([]);
  });

  it('parses a comma-separated list of exact origins', () => {
    expect(parseCorsAllowedOrigins('http://localhost:5173, https://frontend.example.edu.pe'))
      .toEqual(['http://localhost:5173', 'https://frontend.example.edu.pe']);
  });

  it.each([
    '*',
    'http://localhost:5173/*',
    'http://localhost:5173/path',
    'https://frontend.example.edu.pe/',
    'ftp://frontend.example.edu.pe',
    'not a URL',
    'http://localhost:5173,,https://frontend.example.edu.pe',
    'http://localhost:5173,http://localhost:5173',
  ])('rejects ambiguous or unsafe origin configuration: %s', value => {
    expect(() => parseCorsAllowedOrigins(value)).toThrow(CorsConfigurationError);
  });
});

describe('CORS middleware', () => {
  const allowed = ['http://localhost:5173'];

  it('sets the exact allowed origin and Vary, without credentials or wildcard', () => {
    const result = harness({ origin: allowed[0] }, allowed);
    expect(result.headers.get('access-control-allow-origin')).toBe(allowed[0]);
    expect(result.headers.get('vary')).toBe('Origin');
    expect(result.headers.has('access-control-allow-credentials')).toBe(false);
    expect([...result.headers.values()].some(value => value === '*')).toBe(false);
    expect(result.next).toHaveBeenCalledOnce();
  });

  it('does not authorize an unlisted origin and continues the non-preflight request', () => {
    const result = harness({ origin: 'https://unlisted.example' }, allowed);
    expect(result.headers.has('access-control-allow-origin')).toBe(false);
    expect(result.headers.get('vary')).toBe('Origin');
    expect(result.next).toHaveBeenCalledOnce();
  });

  it('does not authorize cross-origin requests when the allow list is empty', () => {
    const result = harness({ origin: allowed[0] }, []);
    expect(result.headers.has('access-control-allow-origin')).toBe(false);
    expect(result.next).toHaveBeenCalledOnce();
  });

  it('answers an authorized POST preflight for Bearer JSON including SSE POST', () => {
    const result = harness({
      method: 'OPTIONS',
      origin: allowed[0],
      requestMethod: 'POST',
      requestHeaders: 'authorization, content-type',
    }, allowed);
    expect(result.statusCode()).toBe(204);
    expect(result.headers.get('access-control-allow-origin')).toBe(allowed[0]);
    expect(result.headers.get('access-control-allow-methods')).toContain('POST');
    expect(result.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
    expect(result.headers.get('vary')).toBe('Origin');
    expect(result.headers.has('access-control-allow-credentials')).toBe(false);
    expect(result.next).not.toHaveBeenCalled();
  });

  it('rejects an unlisted-origin preflight without permissive headers', () => {
    const result = harness({ method: 'OPTIONS', origin: 'https://unlisted.example', requestMethod: 'POST' }, allowed);
    expect(result.statusCode()).toBe(403);
    expect(result.headers.has('access-control-allow-origin')).toBe(false);
    expect(result.headers.has('access-control-allow-headers')).toBe(false);
    expect(result.next).not.toHaveBeenCalled();
  });

  it.each([
    { requestMethod: 'DELETE', requestHeaders: 'authorization, content-type' },
    { requestMethod: 'POST', requestHeaders: 'authorization, x-unapproved-header' },
  ])('rejects a preflight requesting unsupported methods or headers', request => {
    const result = harness({ method: 'OPTIONS', origin: allowed[0], ...request }, allowed);
    expect(result.statusCode()).toBe(403);
    expect(result.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('allows a same-origin-authorized SSE POST response through the middleware', () => {
    const result = harness({ method: 'POST', origin: allowed[0] }, allowed);
    expect(result.headers.get('access-control-allow-origin')).toBe(allowed[0]);
    expect(result.headers.get('vary')).toBe('Origin');
    expect(result.next).toHaveBeenCalledOnce();
  });
});
