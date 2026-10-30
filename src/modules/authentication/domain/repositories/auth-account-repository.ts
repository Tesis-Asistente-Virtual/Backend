import type { AuthAccount } from '../model/auth-account.js';
export interface AuthAccountRepository {
  findByEmail(email: string): Promise<boolean>;
  findCredentialsByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string; status: string } | null>;
  findStatusById(id: string): Promise<string | null>;
  create(email: string, passwordHash: string): Promise<AuthAccount>;
}
