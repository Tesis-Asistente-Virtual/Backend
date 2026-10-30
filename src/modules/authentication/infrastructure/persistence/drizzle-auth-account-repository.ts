import { eq } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts } from './schema.js';
import type { AuthAccount } from '../../domain/model/auth-account.js';
import type { AuthAccountRepository } from '../../domain/repositories/auth-account-repository.js';

export class DrizzleAuthAccountRepository implements AuthAccountRepository {
  constructor(private readonly tx: NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>) {}

  async findByEmail(email: string): Promise<boolean> {
    const [account] = await this.tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.email, email)).limit(1);
    return account !== undefined;
  }

  async create(email: string, passwordHash: string): Promise<AuthAccount> {
    const [account] = await this.tx.insert(authAccounts).values({ email, passwordHash }).returning({ id: authAccounts.id, email: authAccounts.email });
    if (!account) throw new Error('Account insert returned no row');
    return account;
  }
}
