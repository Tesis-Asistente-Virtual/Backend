import { userProfiles } from './schema.js';
export class DrizzleUserProfileRepository {
    tx;
    constructor(tx) {
        this.tx = tx;
    }
    async createForAccount(accountId) {
        await this.tx.insert(userProfiles).values({ accountId, firstName: null, lastName: null, phone: null });
    }
}
