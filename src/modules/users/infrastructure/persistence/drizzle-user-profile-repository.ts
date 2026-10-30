import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { userProfiles } from './schema.js';
import type { UserProfileRepository } from '../../domain/repositories/user-profile-repository.js';

export class DrizzleUserProfileRepository implements UserProfileRepository {
  constructor(private readonly tx: NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>) {}

  async createForAccount(accountId: string): Promise<void> {
    await this.tx.insert(userProfiles).values({ accountId, firstName: null, lastName: null, phone: null });
  }
}
