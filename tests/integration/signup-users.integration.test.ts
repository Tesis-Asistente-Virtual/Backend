import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { connectTestDatabase } from './test-database.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { userProfiles } from '../../src/modules/users/infrastructure/persistence/schema.js';
import { DrizzleSignUpUnitOfWork } from '../../src/modules/authentication/infrastructure/persistence/drizzle-sign-up-unit-of-work.js';
import { DrizzleUserProfileRepository } from '../../src/modules/users/infrastructure/persistence/drizzle-user-profile-repository.js';
import { SignUp, EmailAlreadyRegistered } from '../../src/modules/authentication/application/internal/command-services/sign-up.js';
import { GetMyProfile } from '../../src/modules/users/application/internal/query-services/get-my-profile.js';
import { UpdateMyProfile } from '../../src/modules/users/application/internal/command-services/update-my-profile.js';

const runId = randomUUID();
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const emails = new Set<string>();
const ids = new Set<string>();
const signUp = () => new SignUp(new DrizzleSignUpUnitOfWork(db));
const newEmail = () => { const email = `it-${runId}-${randomUUID()}@example.test`; emails.add(email); return email; };

beforeAll(async () => { ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (!db) return;
  if (ids.size) await db.delete(authAccounts).where(inArray(authAccounts.id, [...ids]));
  if (emails.size) await db.delete(authAccounts).where(inArray(authAccounts.email, [...emails]));
  ids.clear(); emails.clear();
});
afterAll(async () => { if (pool) await pool.end(); });

describe('PostgreSQL SignUp integration', () => {
  it('persists an account and its 1:1 profile with normalized unique email', async () => {
    const email = newEmail();
    const account = await signUp().execute({ email: email.toUpperCase(), password: 'IntegrationPass123!' });
    ids.add(account.id);
    const [storedAccount] = await db.select().from(authAccounts).where(eq(authAccounts.id, account.id));
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.accountId, account.id));
    expect(storedAccount?.email).toBe(email);
    expect(profile?.accountId).toBe(account.id);
    await expect(signUp().execute({ email, password: 'IntegrationPass123!' })).rejects.toBeInstanceOf(EmailAlreadyRegistered);
    await expect(db.insert(authAccounts).values({ email, passwordHash: 'test-hash' })).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('rolls back the real account insert when profile creation fails inside the Unit of Work', async () => {
    const email = newEmail();
    let attemptedAccountId: string | undefined;
    const uow = new DrizzleSignUpUnitOfWork(db, tx => {
      const real = new DrizzleUserProfileRepository(tx);
      return {
        createForAccount: async accountId => { attemptedAccountId = accountId; await real.createForAccount(accountId); throw new Error('controlled integration failure'); },
        findByAccountId: accountId => real.findByAccountId(accountId),
        updateByAccountId: (accountId, changes) => real.updateByAccountId(accountId, changes),
      };
    });
    await expect(new SignUp(uow).execute({ email, password: 'IntegrationPass123!' })).rejects.toThrow('controlled integration failure');
    expect(await db.select().from(authAccounts).where(eq(authAccounts.email, email))).toHaveLength(0);
    expect(attemptedAccountId).toBeDefined();
    expect(await db.select().from(userProfiles).where(eq(userProfiles.accountId, attemptedAccountId!))).toHaveLength(0);
  });

  it('enforces the profile foreign key and unique account_id in PostgreSQL', async () => {
    const email = newEmail();
    const [account] = await db.insert(authAccounts).values({ email, passwordHash: 'test-hash' }).returning({ id: authAccounts.id });
    if (!account) throw new Error('Test account insert did not return an id');
    ids.add(account.id);
    await db.insert(userProfiles).values({ accountId: account.id });
    await expect(db.insert(userProfiles).values({ accountId: account.id })).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(db.insert(userProfiles).values({ accountId: randomUUID() })).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('keeps each account profile isolated during lookup and update', async () => {
    const accountA = await signUp().execute({ email: newEmail(), password: 'IntegrationPass123!' });
    const accountB = await signUp().execute({ email: newEmail(), password: 'IntegrationPass123!' });
    ids.add(accountA.id); ids.add(accountB.id);
    const profiles = new DrizzleUserProfileRepository(db);
    const getProfile = new GetMyProfile(profiles);
    const updateProfile = new UpdateMyProfile(profiles);
    await updateProfile.execute(accountA.id, { firstName: 'Account A' });
    expect(await getProfile.execute(accountA.id)).toMatchObject({ firstName: 'Account A' });
    expect(await getProfile.execute(accountB.id)).toEqual({ firstName: null, lastName: null, phone: null });
    const [storedB] = await db.select().from(userProfiles).where(eq(userProfiles.accountId, accountB.id));
    expect(storedB?.firstName).toBeNull();
  });
});
