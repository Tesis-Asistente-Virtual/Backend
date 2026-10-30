import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import type { SignUpRepositories, SignUpUnitOfWork } from '../../application/internal/command-services/sign-up-unit-of-work.js';
import { DrizzleAuthAccountRepository } from './drizzle-auth-account-repository.js';
import { DrizzleUserProfileRepository } from '../../../users/infrastructure/persistence/drizzle-user-profile-repository.js';
import type { db as database } from '../../../../shared/infrastructure/database/client.js';

type Database = NonNullable<typeof database>;

export class DrizzleSignUpUnitOfWork implements SignUpUnitOfWork {
  constructor(private readonly db: Database) {}

  execute<T>(work: (repositories: SignUpRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx: NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>) => {
      return work({
        accounts: new DrizzleAuthAccountRepository(tx),
        profiles: new DrizzleUserProfileRepository(tx),
      });
    });
  }
}
