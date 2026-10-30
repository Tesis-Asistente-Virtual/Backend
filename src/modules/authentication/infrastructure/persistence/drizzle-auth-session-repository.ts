import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, exists, gt, isNull } from 'drizzle-orm';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts, authSessions } from './schema.js';
import type { AuthSessionRecord, AuthSessionRepository, CreateAuthSession } from '../../domain/repositories/auth-session-repository.js';

export class DrizzleAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async create(session: CreateAuthSession): Promise<void> {
    await this.db.insert(authSessions).values({ accountId: session.accountId, refreshTokenHash: session.refreshTokenHash, expiresAt: session.expiresAt, revokedAt: null });
  }
  async findByRefreshTokenHash(hash: string): Promise<AuthSessionRecord | null> {
    const [row] = await this.db.select({ id: authSessions.id, accountId: authSessions.accountId, expiresAt: authSessions.expiresAt, revokedAt: authSessions.revokedAt, accountStatus: authAccounts.status }).from(authSessions).innerJoin(authAccounts, eq(authAccounts.id, authSessions.accountId)).where(eq(authSessions.refreshTokenHash, hash)).limit(1);
    return row ?? null;
  }
  async rotate(hash: string, replacementHash: string, expiresAt: Date, now: Date): Promise<string | null> {
    const activeAccount = this.db.select({ id: authAccounts.id }).from(authAccounts).where(and(eq(authAccounts.id, authSessions.accountId), eq(authAccounts.status, 'active')));
    const [updated] = await this.db.update(authSessions).set({ refreshTokenHash: replacementHash, expiresAt }).where(and(eq(authSessions.refreshTokenHash, hash), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now), exists(activeAccount))).returning({ accountId: authSessions.accountId });
    return updated?.accountId ?? null;
  }
  async revokeByHash(hash: string, revokedAt: Date): Promise<boolean> {
    const [updated] = await this.db.update(authSessions).set({ revokedAt }).where(and(eq(authSessions.refreshTokenHash, hash), isNull(authSessions.revokedAt))).returning({ id: authSessions.id });
    return updated !== undefined;
  }
}
