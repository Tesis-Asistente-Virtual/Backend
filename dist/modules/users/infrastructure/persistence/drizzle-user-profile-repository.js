import { eq } from 'drizzle-orm';
import { userProfiles } from './schema.js';
export class DrizzleUserProfileRepository {
    tx;
    constructor(tx) {
        this.tx = tx;
    }
    async createForAccount(accountId) {
        await this.tx.insert(userProfiles).values({ accountId, firstName: null, lastName: null, phone: null });
    }
    async findByAccountId(accountId) {
        const [profile] = await this.tx.select({ firstName: userProfiles.firstName, lastName: userProfiles.lastName, phone: userProfiles.phone }).from(userProfiles).where(eq(userProfiles.accountId, accountId)).limit(1);
        return profile ?? null;
    }
    async updateByAccountId(accountId, changes) {
        const [profile] = await this.tx.update(userProfiles).set({ ...changes, updatedAt: new Date() }).where(eq(userProfiles.accountId, accountId)).returning({ firstName: userProfiles.firstName, lastName: userProfiles.lastName, phone: userProfiles.phone });
        return profile ?? null;
    }
}
