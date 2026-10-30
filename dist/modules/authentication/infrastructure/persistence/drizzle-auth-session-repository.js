import { and, eq, exists, gt, isNull } from 'drizzle-orm';
import { authAccounts, authSessions } from './schema.js';
export class DrizzleAuthSessionRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(session) {
        await this.db.insert(authSessions).values({ accountId: session.accountId, refreshTokenHash: session.refreshTokenHash, expiresAt: session.expiresAt, revokedAt: null });
    }
    async findByRefreshTokenHash(hash) {
        const [row] = await this.db.select({ id: authSessions.id, accountId: authSessions.accountId, expiresAt: authSessions.expiresAt, revokedAt: authSessions.revokedAt, accountStatus: authAccounts.status }).from(authSessions).innerJoin(authAccounts, eq(authAccounts.id, authSessions.accountId)).where(eq(authSessions.refreshTokenHash, hash)).limit(1);
        return row ?? null;
    }
    async rotate(hash, replacementHash, expiresAt, now) {
        const activeAccount = this.db.select({ id: authAccounts.id }).from(authAccounts).where(and(eq(authAccounts.id, authSessions.accountId), eq(authAccounts.status, 'active')));
        const [updated] = await this.db.update(authSessions).set({ refreshTokenHash: replacementHash, expiresAt }).where(and(eq(authSessions.refreshTokenHash, hash), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now), exists(activeAccount))).returning({ accountId: authSessions.accountId });
        return updated?.accountId ?? null;
    }
    async revokeByHash(hash, revokedAt) {
        const [updated] = await this.db.update(authSessions).set({ revokedAt }).where(and(eq(authSessions.refreshTokenHash, hash), isNull(authSessions.revokedAt))).returning({ id: authSessions.id });
        return updated !== undefined;
    }
}
