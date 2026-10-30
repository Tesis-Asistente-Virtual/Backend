import type { AuthAccount } from '../model/auth-account.js';
export interface AuthAccountRepository {
  findByEmail(email: string): Promise<boolean>;
  create(email: string, passwordHash: string): Promise<AuthAccount>;
}
