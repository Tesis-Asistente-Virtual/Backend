import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verify } from 'argon2';
import type { AuthAccountRepository } from '../../../src/modules/authentication/domain/repositories/auth-account-repository.js';
import type { AuthSessionRepository } from '../../../src/modules/authentication/domain/repositories/auth-session-repository.js';
import { InvalidCredentials, SignIn } from '../../../src/modules/authentication/application/internal/command-services/sign-in.js';
import { OpaqueRefreshTokenGenerator } from '../../../src/modules/authentication/infrastructure/security/opaque-refresh-token-generator.js';
import { JwtAccessTokenService } from '../../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { SignJWT } from 'jose';

vi.mock('argon2', () => ({ verify: vi.fn() }));
const verifyMock = vi.mocked(verify);
const creds = { email: 'student@example.edu', password: 'password long enough' };

function harness(account: { id: string; email: string; passwordHash: string; status: string } | null = { id: 'uuid-123', email: creds.email, passwordHash: 'stored-hash', status: 'active' }, sessionError = false) {
  const accounts: AuthAccountRepository = { findByEmail: vi.fn(async () => Boolean(account)), findCredentialsByEmail: vi.fn(async () => account), findStatusById: vi.fn(async () => account?.status ?? null), create: vi.fn() };
  const sessions: AuthSessionRepository = { create: vi.fn(async () => { if (sessionError) throw new Error('persistence failed'); }), findByRefreshTokenHash: vi.fn(async () => null), rotate: vi.fn(async () => null), revokeByHash: vi.fn(async () => false) };
  const tokens = { issue: vi.fn(async () => 'jwt-access') };
  const refresh = { generate: vi.fn(() => ({ token: 'opaque-original', hash: 'sha256-hash' })) };
  return { service: new SignIn(accounts, sessions, tokens, refresh, 900, 604800), accounts, sessions, tokens, refresh };
}

beforeEach(() => { verifyMock.mockReset(); });

describe('SignIn', () => {
  it('authenticates, persists only refresh hash, then issues tokens', async () => {
    verifyMock.mockResolvedValue(true);
    const h = harness();
    await expect(h.service.execute(creds)).resolves.toEqual({ accessToken: 'jwt-access', refreshToken: 'opaque-original', tokenType: 'Bearer', expiresIn: 900 });
    expect(h.accounts.findCredentialsByEmail).toHaveBeenCalledWith(creds.email);
    expect(h.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'uuid-123', refreshTokenHash: 'sha256-hash', expiresAt: expect.any(Date) }));
    expect(h.sessions.create).not.toHaveBeenCalledWith(expect.objectContaining({ refreshTokenHash: 'opaque-original' }));
    expect(h.tokens.issue).toHaveBeenCalledWith('uuid-123');
  });

  it('rejects missing accounts and incorrect passwords generically', async () => {
    const missing = harness(null);
    await expect(missing.service.execute(creds)).rejects.toBeInstanceOf(InvalidCredentials);
    verifyMock.mockResolvedValue(false);
    await expect(harness().service.execute(creds)).rejects.toBeInstanceOf(InvalidCredentials);
  });

  it('rejects inactive accounts', async () => {
    verifyMock.mockResolvedValue(true);
    await expect(harness({ id: 'id', email: creds.email, passwordHash: 'hash', status: 'disabled' }).service.execute(creds)).rejects.toBeInstanceOf(InvalidCredentials);
  });

  it('does not issue tokens if session persistence fails and normalizes email', async () => {
    verifyMock.mockResolvedValue(true);
    const h = harness({ id: 'uuid-123', email: creds.email, passwordHash: 'stored-hash', status: 'active' }, true);
    await expect(h.service.execute({ ...creds, email: 'Student@Example.edu' })).rejects.toThrow('persistence failed');
    expect(h.accounts.findCredentialsByEmail).toHaveBeenCalledWith(creds.email);
    expect(h.tokens.issue).not.toHaveBeenCalled();
  });
});

describe('token security services', () => {
  it('creates verifiable JWT claims without personal data', async () => {
    const jwt = new JwtAccessTokenService('a'.repeat(32), 'issuer', 'audience', 900);
    const token = await jwt.issue('account-uuid');
    expect(await jwt.verify(token)).toMatchObject({ sub: 'account-uuid' });
    expect(token).not.toContain(creds.email);
  });

  it('rejects expired JWTs', async () => {
    const secret = new TextEncoder().encode('b'.repeat(32));
    const jwt = new JwtAccessTokenService('b'.repeat(32), 'issuer', 'audience', 900);
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('account-uuid').setIssuer('issuer').setAudience('audience').setIssuedAt(1).setExpirationTime(2).sign(secret);
    expect(await jwt.verify(expired)).toBeNull();
  });

  it('rejects signatures, algorithms, issuer and audience that do not match', async () => {
    const jwt = new JwtAccessTokenService('c'.repeat(32), 'issuer', 'audience', 900);
    const valid = await jwt.issue('account-uuid');
    const altered = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`;
    expect(await jwt.verify(altered)).toBeNull();

    const secret = new TextEncoder().encode('c'.repeat(32));
    const wrongAlgorithm = await new SignJWT({}).setProtectedHeader({ alg: 'HS384' }).setSubject('account-uuid').setIssuer('issuer').setAudience('audience').setIssuedAt().setExpirationTime('5m').sign(secret);
    const wrongIssuer = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('account-uuid').setIssuer('other').setAudience('audience').setIssuedAt().setExpirationTime('5m').sign(secret);
    const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('account-uuid').setIssuer('issuer').setAudience('other').setIssuedAt().setExpirationTime('5m').sign(secret);
    expect(await jwt.verify(wrongAlgorithm)).toBeNull();
    expect(await jwt.verify(wrongIssuer)).toBeNull();
    expect(await jwt.verify(wrongAudience)).toBeNull();
  });

  it('generates high-entropy refresh tokens and stores a one-way hash value', () => {
    const generator = new OpaqueRefreshTokenGenerator();
    const token = generator.generate();
    expect(Buffer.from(token.token, 'base64url').byteLength).toBeGreaterThanOrEqual(32);
    expect(token.hash).not.toBe(token.token);
    expect(token.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

