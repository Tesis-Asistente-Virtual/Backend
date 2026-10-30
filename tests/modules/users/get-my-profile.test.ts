import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { GetMyProfile, ProfileNotFound } from '../../../src/modules/users/application/internal/query-services/get-my-profile.js';
import { MyProfileController } from '../../../src/modules/users/interfaces/rest/resources/my-profile-controller.js';
import { authenticationMiddleware } from '../../../src/shared/infrastructure/http/authentication-middleware.js';
import { JwtAccessTokenService } from '../../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import type { UserProfileRepository } from '../../../src/modules/users/domain/repositories/user-profile-repository.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
function repo(found = true): UserProfileRepository {
  return { createForAccount: vi.fn(async () => {}), findByAccountId: vi.fn(async () => found ? { firstName: null, lastName: null, phone: null } : null), updateByAccountId: vi.fn(async () => found ? { firstName: null, lastName: null, phone: null } : null) };
}

describe('GET my profile use case/controller', () => {
  it('returns the current profile and queries only by authenticated account id', async () => {
    const profiles = repo();
    const useCase = new GetMyProfile(profiles);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await new MyProfileController(useCase).handle({ auth: { accountId }, query: { accountId: 'other' } } as never, response as never);
    expect(profiles.findByAccountId).toHaveBeenCalledWith(accountId);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ firstName: null, lastName: null, phone: null });
  });
  it('returns not found when the profile is missing', async () => {
    await expect(new GetMyProfile(repo(false)).execute(accountId)).rejects.toBeInstanceOf(ProfileNotFound);
  });
});

describe('authentication middleware', () => {
  const jwt = new JwtAccessTokenService('x'.repeat(32), 'issuer', 'audience', 900);
  async function run(authHeader?: string) {
    const req = { get: (name: string) => name === 'authorization' ? authHeader : undefined, headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    authenticationMiddleware(jwt)(req as never, res as never, next);
    await new Promise(resolve => setTimeout(resolve, 20));
    const requestAccount = (req as unknown as { auth?: { accountId: string } }).auth?.accountId;
    return { res, requestAccount };
  }
  it('rejects a missing or malformed bearer token', async () => {
    expect((await run()).res.status).toHaveBeenCalledWith(401);
    expect((await run('Basic abc')).res.status).toHaveBeenCalledWith(401);
  });
  it('accepts only a verified JWT with UUID subject and sets accountId from sub', async () => {
    const token = await jwt.issue(accountId);
    expect((await run(`Bearer ${token}`)).requestAccount).toBe(accountId);
  });
  it('rejects expired, bad-signature and mismatched issuer/audience tokens', async () => {
    const otherKey = new TextEncoder().encode('y'.repeat(32));
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(accountId).setIssuer('issuer').setAudience('audience').setIssuedAt(1).setExpirationTime(2).sign(new TextEncoder().encode('x'.repeat(32)));
    const wrongIssuer = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(accountId).setIssuer('wrong').setAudience('audience').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('x'.repeat(32)));
    const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(accountId).setIssuer('issuer').setAudience('wrong').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('x'.repeat(32)));
    const badSignature = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(accountId).setIssuer('issuer').setAudience('audience').setIssuedAt().setExpirationTime('5m').sign(otherKey);
    for (const token of [expired, wrongIssuer, wrongAudience, badSignature]) expect((await run(`Bearer ${token}`)).res.status).toHaveBeenCalledWith(401);
  });
});

