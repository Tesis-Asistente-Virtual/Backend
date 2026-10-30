import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthAccountRepository } from '../../../src/modules/authentication/domain/repositories/auth-account-repository.js';
import type { UserProfileRepository } from '../../../src/modules/users/domain/repositories/user-profile-repository.js';
import type { SignUpRepositories, SignUpUnitOfWork } from '../../../src/modules/authentication/application/internal/command-services/sign-up-unit-of-work.js';
import { EmailAlreadyRegistered, SignUp } from '../../../src/modules/authentication/application/internal/command-services/sign-up.js';
import { SignUpController } from '../../../src/modules/authentication/interfaces/rest/resources/sign-up-controller.js';

const signupInput = { email: 'Student@University.edu.pe', password: 'EjemploSeguro123!' };

function createHarness(options: { duplicate?: boolean; failProfile?: boolean } = {}) {
  const accounts = new Map<string, { id: string; email: string; passwordHash: string }>();
  const profiles = new Map<string, { accountId: string }>();
  const accountRepository: AuthAccountRepository = {
    findByEmail: vi.fn(async email => accounts.has(email) || options.duplicate === true),
    findCredentialsByEmail: vi.fn(async () => null),
    findStatusById: vi.fn(async () => null),
    create: vi.fn(async (email, passwordHash) => {
      const row = { id: 'account-id', email, passwordHash };
      accounts.set(email, row);
      return { id: row.id, email: row.email };
    }),
  };
  const profileRepository: UserProfileRepository = {
    createForAccount: vi.fn(async accountId => {
      if (options.failProfile) throw new Error('simulated profile failure');
      profiles.set(accountId, { accountId });
    }),
    findByAccountId: vi.fn(async () => null),
    updateByAccountId: vi.fn(async () => null),
  };
  const uow: SignUpUnitOfWork = {
    execute: async work => {
      const savedAccounts = new Map(accounts);
      const savedProfiles = new Map(profiles);
      try {
        return await work({ accounts: accountRepository, profiles: profileRepository });
      } catch (error) {
        accounts.clear();
        savedAccounts.forEach((value, key) => accounts.set(key, value));
        profiles.clear();
        savedProfiles.forEach((value, key) => profiles.set(key, value));
        throw error;
      }
    },
  };
  return { signUp: new SignUp(uow), accountRepository, profileRepository, accounts, profiles };
}

afterEach(() => vi.restoreAllMocks());

describe('SignUp', () => {
  it('registers an account and associated profile', async () => {
    const h = createHarness();
    await expect(h.signUp.execute(signupInput)).resolves.toMatchObject({ id: 'account-id', email: 'student@university.edu.pe' });
    expect(h.accounts.size).toBe(1);
    expect(h.profiles.get('account-id')).toEqual({ accountId: 'account-id' });
    expect(h.accountRepository.create).toHaveBeenCalledWith('student@university.edu.pe', expect.any(String));
  });

  it('rejects an invalid email', async () => {
    const h = createHarness();
    await expect(h.signUp.execute({ ...signupInput, email: 'bad-email' })).rejects.toThrow();
    expect(h.accountRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a short password', async () => {
    const h = createHarness();
    await expect(h.signUp.execute({ ...signupInput, password: 'short' })).rejects.toThrow();
    expect(h.accountRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email', async () => {
    const h = createHarness({ duplicate: true });
    await expect(h.signUp.execute(signupInput)).rejects.toBeInstanceOf(EmailAlreadyRegistered);
    expect(h.accountRepository.create).not.toHaveBeenCalled();
    expect(h.profileRepository.createForAccount).not.toHaveBeenCalled();
  });

  it('normalizes email before repository access', async () => {
    const h = createHarness();
    await h.signUp.execute(signupInput);
    expect(h.accountRepository.findByEmail).toHaveBeenCalledWith('student@university.edu.pe');
  });

  it('propagates profile failures and rolls back the unit of work state', async () => {
    const h = createHarness({ failProfile: true });
    await expect(h.signUp.execute(signupInput)).rejects.toThrow('simulated profile failure');
    expect(h.accounts.size).toBe(0);
    expect(h.profiles.size).toBe(0);
  });

  it('returns only public account fields from the HTTP controller', async () => {
    const h = createHarness();
    const controller = new SignUpController(h.signUp);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await controller.handle({ body: signupInput } as never, response as never);
    expect(response.status).toHaveBeenCalledWith(201);
    const body = response.json.mock.calls[0]?.[0];
    expect(body).toEqual({ id: 'account-id', email: 'student@university.edu.pe', message: 'Cuenta registrada correctamente' });
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
  });
});
