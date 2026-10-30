import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionRecord, AuthSessionRepository } from '../../../src/modules/authentication/domain/repositories/auth-session-repository.js';
import { InvalidRefreshToken, RefreshSession } from '../../../src/modules/authentication/application/internal/command-services/refresh-session.js';
import { SignOut } from '../../../src/modules/authentication/application/internal/command-services/sign-out.js';

const now = new Date();
const valid: AuthSessionRecord = { id: 'session', accountId: 'account', expiresAt: new Date(now.getTime() + 60_000), revokedAt: null, accountStatus: 'active' };

function harness(record: AuthSessionRecord | null = valid) {
  let currentHash = 'old-hash';
  let revoked = false;
  const sessions: AuthSessionRepository = {
    create: vi.fn(async () => {}),
    findByRefreshTokenHash: vi.fn(async hash => hash === currentHash && !revoked ? record : null),
    rotate: vi.fn(async (oldHash, newHash) => {
      if (oldHash !== currentHash || revoked) return null;
      currentHash = newHash;
      return 'account';
    }),
    revokeByHash: vi.fn(async hash => {
      if (hash !== currentHash || revoked) return false;
      revoked = true;
      return true;
    }),
  };
  const jwt = { issue: vi.fn(async () => 'new-access') };
  let generated = 0;
  const tokens = { hash: vi.fn((token: string) => token === 'old' ? 'old-hash' : token === 'new' ? 'new-hash' : 'other-hash'), generate: vi.fn(() => { generated += 1; return { token: generated === 1 ? 'new' : `next-${generated}`, hash: generated === 1 ? 'new-hash' : `hash-${generated}` }; }) };
  return { sessions, jwt, tokens, refresh: new RefreshSession(sessions, jwt, tokens, 900, 604800), signOut: new SignOut(sessions, tokens) };
}

describe('RefreshSession and SignOut', () => {
  it('rotates a valid refresh token and issues new credentials', async () => {
    const h = harness();
    await expect(h.refresh.execute({ refreshToken: 'old' })).resolves.toEqual({ accessToken: 'new-access', refreshToken: 'new', tokenType: 'Bearer', expiresIn: 900 });
    expect(h.sessions.rotate).toHaveBeenCalledWith('old-hash', 'new-hash', expect.any(Date), expect.any(Date));
  });
  it('rejects nonexistent, expired, revoked, and disabled-account sessions', async () => {
    await expect(harness(null).refresh.execute({ refreshToken: 'old' })).rejects.toBeInstanceOf(InvalidRefreshToken);
    await expect(harness({ ...valid, expiresAt: new Date(0) }).refresh.execute({ refreshToken: 'old' })).rejects.toBeInstanceOf(InvalidRefreshToken);
    await expect(harness({ ...valid, revokedAt: now }).refresh.execute({ refreshToken: 'old' })).rejects.toBeInstanceOf(InvalidRefreshToken);
    await expect(harness({ ...valid, accountStatus: 'disabled' }).refresh.execute({ refreshToken: 'old' })).rejects.toBeInstanceOf(InvalidRefreshToken);
  });
  it('allows only one of two concurrent refreshes to consume the token', async () => {
    const h = harness();
    const results = await Promise.allSettled([h.refresh.execute({ refreshToken: 'old' }), h.refresh.execute({ refreshToken: 'old' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });
  it('revokes the session and then rejects refresh using its previous token', async () => {
    const h = harness();
    await h.signOut.execute({ refreshToken: 'old' });
    expect(h.sessions.revokeByHash).toHaveBeenCalledWith('old-hash', expect.any(Date));
    await expect(h.refresh.execute({ refreshToken: 'old' })).rejects.toBeInstanceOf(InvalidRefreshToken);
  });
});
