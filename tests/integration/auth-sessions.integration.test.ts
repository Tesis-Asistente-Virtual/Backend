import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { connectTestDatabase } from './test-database.js';
import { authAccounts, authSessions } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { DrizzleAuthAccountRepository } from '../../src/modules/authentication/infrastructure/persistence/drizzle-auth-account-repository.js';
import { DrizzleAuthSessionRepository } from '../../src/modules/authentication/infrastructure/persistence/drizzle-auth-session-repository.js';
import { SignIn, InvalidCredentials } from '../../src/modules/authentication/application/internal/command-services/sign-in.js';
import { RefreshSession, InvalidRefreshToken } from '../../src/modules/authentication/application/internal/command-services/refresh-session.js';
import { SignOut } from '../../src/modules/authentication/application/internal/command-services/sign-out.js';
import { OpaqueRefreshTokenGenerator } from '../../src/modules/authentication/infrastructure/security/opaque-refresh-token-generator.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';

const runId = randomUUID();
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const accountIds = new Set<string>();
const emails = new Set<string>();
const password = 'IntegrationOnly!123';
const jwt = new JwtAccessTokenService('integration-secret-not-used-outside-tests-32', 'integration-tests', 'integration-client', 900);
const refreshTokens = new OpaqueRefreshTokenGenerator();
const sessions = () => new DrizzleAuthSessionRepository(db);
const signIn = () => new SignIn(new DrizzleAuthAccountRepository(db), sessions(), jwt, refreshTokens, 900, 604800);
const refreshSession = () => new RefreshSession(sessions(), jwt, refreshTokens, 900, 604800);
const newEmail = () => { const email = `session-it-${runId}-${randomUUID()}@example.test`; emails.add(email); return email; };

async function createAccount(status = 'active') {
  const email = newEmail();
  const passwordHash = await hash(password, { type: 2 });
  const [account] = await db.insert(authAccounts).values({ email, passwordHash, status }).returning({ id: authAccounts.id });
  if (!account) throw new Error('Integration test account insert returned no id');
  accountIds.add(account.id);
  return { id: account.id, email };
}

beforeAll(async () => { ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (!db) return;
  if (accountIds.size) await db.delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
  if (emails.size) await db.delete(authAccounts).where(inArray(authAccounts.email, [...emails]));
  accountIds.clear(); emails.clear();
});
afterAll(async () => { if (pool) await pool.end(); });

describe('Authentication session PostgreSQL integration', () => {
  it('persists SignIn sessions with account association, SHA-256 hash, expiry, and null revoked_at', async () => {
    const account = await createAccount();
    const result = await signIn().execute({ email: account.email, password });
    const tokenHash = refreshTokens.hash(result.refreshToken);
    const [session] = await db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, tokenHash));
    expect(session?.accountId).toBe(account.id);
    expect(session?.refreshTokenHash).toBe(tokenHash);
    expect(session?.refreshTokenHash).not.toBe(result.refreshToken);
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session?.revokedAt).toBeNull();
  });

  it('rejects incorrect credentials and disabled accounts', async () => {
    const active = await createAccount();
    await expect(signIn().execute({ email: active.email, password: 'wrong-password' })).rejects.toBeInstanceOf(InvalidCredentials);
    const disabled = await createAccount('disabled');
    await expect(signIn().execute({ email: disabled.email, password })).rejects.toBeInstanceOf(InvalidCredentials);
    expect(await db.select().from(authSessions).where(eq(authSessions.accountId, active.id))).toHaveLength(0);
    expect(await db.select().from(authSessions).where(eq(authSessions.accountId, disabled.id))).toHaveLength(0);
  });

  it('rotates the persisted hash, rejects the previous token, and accepts the replacement', async () => {
    const account = await createAccount();
    const signedIn = await signIn().execute({ email: account.email, password });
    const oldHash = refreshTokens.hash(signedIn.refreshToken);
    const oldSession = (await db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, oldHash)))[0];
    const renewed = await refreshSession().execute({ refreshToken: signedIn.refreshToken });
    const newHash = refreshTokens.hash(renewed.refreshToken);
    const updatedRows = await db.select().from(authSessions).where(eq(authSessions.accountId, account.id));
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]?.id).toBe(oldSession?.id);
    expect(updatedRows[0]?.refreshTokenHash).toBe(newHash);
    expect(newHash).not.toBe(oldHash);
    await expect(refreshSession().execute({ refreshToken: signedIn.refreshToken })).rejects.toBeInstanceOf(InvalidRefreshToken);
    const renewedAgain = await refreshSession().execute({ refreshToken: renewed.refreshToken });
    expect(renewedAgain.refreshToken).not.toBe(renewed.refreshToken);
  });

  it('rejects expired and revoked sessions', async () => {
    const expiredAccount = await createAccount();
    const expiredSignIn = await signIn().execute({ email: expiredAccount.email, password });
    const expiredHash = refreshTokens.hash(expiredSignIn.refreshToken);
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(authSessions.refreshTokenHash, expiredHash));
    await expect(refreshSession().execute({ refreshToken: expiredSignIn.refreshToken })).rejects.toBeInstanceOf(InvalidRefreshToken);

    const revokedAccount = await createAccount();
    const revokedSignIn = await signIn().execute({ email: revokedAccount.email, password });
    const revokedHash = refreshTokens.hash(revokedSignIn.refreshToken);
    await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.refreshTokenHash, revokedHash));
    await expect(refreshSession().execute({ refreshToken: revokedSignIn.refreshToken })).rejects.toBeInstanceOf(InvalidRefreshToken);
  });

  it('allows exactly one concurrent refresh on independent pool connections', async () => {
    const account = await createAccount();
    const signedIn = await signIn().execute({ email: account.email, password });
    const oldHash = refreshTokens.hash(signedIn.refreshToken);
    const results = await Promise.allSettled([
      refreshSession().execute({ refreshToken: signedIn.refreshToken }),
      refreshSession().execute({ refreshToken: signedIn.refreshToken }),
    ]);
    const successful = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<ReturnType<typeof refreshSession>['execute']>>> => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const currentSessions = await db.select().from(authSessions).where(eq(authSessions.accountId, account.id));
    expect(currentSessions).toHaveLength(1);
    expect(currentSessions[0]?.refreshTokenHash).toBe(refreshTokens.hash(successful[0]!.value.refreshToken));
    expect(currentSessions[0]?.refreshTokenHash).not.toBe(oldHash);
    await expect(refreshSession().execute({ refreshToken: signedIn.refreshToken })).rejects.toBeInstanceOf(InvalidRefreshToken);
  });

  it('revokes only the selected session and makes its refresh token unusable', async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();
    const signedInA = await signIn().execute({ email: accountA.email, password });
    const signedInB = await signIn().execute({ email: accountB.email, password });
    const hashA = refreshTokens.hash(signedInA.refreshToken);
    const hashB = refreshTokens.hash(signedInB.refreshToken);
    await new SignOut(sessions(), refreshTokens).execute({ refreshToken: signedInA.refreshToken });
    const [sessionA] = await db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, hashA));
    const [sessionB] = await db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, hashB));
    expect(sessionA?.revokedAt).toBeInstanceOf(Date);
    expect(sessionB?.revokedAt).toBeNull();
    await expect(refreshSession().execute({ refreshToken: signedInA.refreshToken })).rejects.toBeInstanceOf(InvalidRefreshToken);
    await expect(refreshSession().execute({ refreshToken: signedInB.refreshToken })).resolves.toMatchObject({ tokenType: 'Bearer' });
  });
});
