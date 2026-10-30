import type { AuthAccountRepository } from '../../../domain/repositories/auth-account-repository.js';
import type { UserProfileRepository } from '../../../../users/domain/repositories/user-profile-repository.js';

/** Supplies repositories bound to one atomic persistence transaction. */
export interface SignUpRepositories {
  accounts: AuthAccountRepository;
  profiles: UserProfileRepository;
}

export interface SignUpUnitOfWork {
  execute<T>(work: (repositories: SignUpRepositories) => Promise<T>): Promise<T>;
}
