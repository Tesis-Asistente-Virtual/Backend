import { eq } from 'drizzle-orm';
import { authAccounts } from './schema.js';
export class DrizzleAuthAccountRepository {
    tx;
    constructor(tx) {
        this.tx = tx;
    }
    async findByEmail(email) {
        const [account] = await this.tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.email, email)).limit(1);
        return account !== undefined;
    }
    async create(email, passwordHash) {
        const [account] = await this.tx.insert(authAccounts).values({ email, passwordHash }).returning({ id: authAccounts.id, email: authAccounts.email });
        if (!account)
            throw new Error('Account insert returned no row');
        return account;
    }
}
