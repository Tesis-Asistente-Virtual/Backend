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
    async findCredentialsByEmail(email) {
        const [account] = await this.tx.select({ id: authAccounts.id, email: authAccounts.email, passwordHash: authAccounts.passwordHash, status: authAccounts.status }).from(authAccounts).where(eq(authAccounts.email, email)).limit(1);
        return account ?? null;
    }
    async findStatusById(id) {
        const [account] = await this.tx.select({ status: authAccounts.status }).from(authAccounts).where(eq(authAccounts.id, id)).limit(1);
        return account?.status ?? null;
    }
    async create(email, passwordHash) {
        const [account] = await this.tx.insert(authAccounts).values({ email, passwordHash }).returning({ id: authAccounts.id, email: authAccounts.email });
        if (!account)
            throw new Error('Account insert returned no row');
        return account;
    }
}
