import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres';
import { eq, type ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { userProfiles } from './schema.js';
import type { UserProfileRepository } from '../../domain/repositories/user-profile-repository.js';

export class DrizzleUserProfileRepository implements UserProfileRepository {
  constructor(private readonly tx: NodePgDatabase<typeof schema> | NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>) {}

  async createForAccount(accountId: string): Promise<void> {
    await this.tx.insert(userProfiles).values({ accountId, firstName: null, lastName: null, phone: null });
  }

  async findByAccountId(accountId: string) {
    const [profile] = await this.tx.select({ firstName: userProfiles.firstName, lastName: userProfiles.lastName, phone: userProfiles.phone }).from(userProfiles).where(eq(userProfiles.accountId, accountId)).limit(1);
    return profile ?? null;
  }

  async updateByAccountId(accountId: string, changes: { firstName?: string | null; lastName?: string | null; phone?: string | null }) {
    const [profile] = await this.tx.update(userProfiles).set({ ...changes, updatedAt: new Date() }).where(eq(userProfiles.accountId, accountId)).returning({ firstName: userProfiles.firstName, lastName: userProfiles.lastName, phone: userProfiles.phone });
    return profile ?? null;
  }
}
