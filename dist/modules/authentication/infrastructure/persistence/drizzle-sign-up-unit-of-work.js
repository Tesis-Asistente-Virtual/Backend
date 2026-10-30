import { DrizzleAuthAccountRepository } from './drizzle-auth-account-repository.js';
import { DrizzleUserProfileRepository } from '../../../users/infrastructure/persistence/drizzle-user-profile-repository.js';
export class DrizzleSignUpUnitOfWork {
    db;
    constructor(db) {
        this.db = db;
    }
    execute(work) {
        return this.db.transaction(async (tx) => {
            return work({
                accounts: new DrizzleAuthAccountRepository(tx),
                profiles: new DrizzleUserProfileRepository(tx),
            });
        });
    }
}
