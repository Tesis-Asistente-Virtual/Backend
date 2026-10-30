import { DrizzleAuthAccountRepository } from './drizzle-auth-account-repository.js';
import { DrizzleUserProfileRepository } from '../../../users/infrastructure/persistence/drizzle-user-profile-repository.js';
export class DrizzleSignUpUnitOfWork {
    db;
    profileRepositoryFactory;
    constructor(db, profileRepositoryFactory = tx => new DrizzleUserProfileRepository(tx)) {
        this.db = db;
        this.profileRepositoryFactory = profileRepositoryFactory;
    }
    execute(work) {
        return this.db.transaction(async (tx) => {
            return work({
                accounts: new DrizzleAuthAccountRepository(tx),
                profiles: this.profileRepositoryFactory(tx),
            });
        });
    }
}
