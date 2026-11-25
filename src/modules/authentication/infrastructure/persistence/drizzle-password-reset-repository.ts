import { and, desc, eq, gt, isNull, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts, authPasswordResetCodes, authSessions } from './schema.js';
import type { PasswordResetRepository } from '../../domain/repositories/password-reset-repository.js';

export class DrizzlePasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findActiveAccountByEmail(email: string) {
    const [account] = await this.db.select({ id: authAccounts.id }).from(authAccounts)
      .where(and(eq(authAccounts.email, email), eq(authAccounts.status, 'active'))).limit(1);
    return account ?? null;
  }

  async findLatestCodeCreatedAt(accountId: string) {
    const [row] = await this.db.select({ createdAt: authPasswordResetCodes.createdAt }).from(authPasswordResetCodes)
      .where(eq(authPasswordResetCodes.accountId, accountId)).orderBy(desc(authPasswordResetCodes.createdAt)).limit(1);
    return row?.createdAt ?? null;
  }

  async createCode(input: { accountId: string; codeHash: string; createdAt: Date; expiresAt: Date }) {
    await this.db.insert(authPasswordResetCodes).values({
      accountId: input.accountId, codeHash: input.codeHash, createdAt: input.createdAt, expiresAt: input.expiresAt,
    });
  }

  async consumeOpenCodes(accountId: string, now: Date) {
    await this.db.update(authPasswordResetCodes).set({ consumedAt: now })
      .where(and(eq(authPasswordResetCodes.accountId, accountId), isNull(authPasswordResetCodes.consumedAt)));
  }

  async findOpenCode(accountId: string, now: Date) {
    const [row] = await this.db.select({
      id: authPasswordResetCodes.id, codeHash: authPasswordResetCodes.codeHash,
      attempts: authPasswordResetCodes.attempts, verifiedAt: authPasswordResetCodes.verifiedAt,
    }).from(authPasswordResetCodes).where(and(
      eq(authPasswordResetCodes.accountId, accountId), isNull(authPasswordResetCodes.consumedAt),
      gt(authPasswordResetCodes.expiresAt, now),
    )).orderBy(desc(authPasswordResetCodes.createdAt)).limit(1);
    return row ?? null;
  }

  async incrementAttempts(codeId: string) {
    await this.db.update(authPasswordResetCodes).set({ attempts: sql`${authPasswordResetCodes.attempts} + 1` })
      .where(eq(authPasswordResetCodes.id, codeId));
  }

  async markVerified(codeId: string, resetTokenHash: string, now: Date) {
    await this.db.update(authPasswordResetCodes).set({ verifiedAt: now, resetTokenHash })
      .where(and(eq(authPasswordResetCodes.id, codeId), isNull(authPasswordResetCodes.verifiedAt)));
  }

  async findVerifiedCodeByTokenHash(accountId: string, resetTokenHash: string, now: Date) {
    const [row] = await this.db.select({ id: authPasswordResetCodes.id }).from(authPasswordResetCodes).where(and(
      eq(authPasswordResetCodes.accountId, accountId), eq(authPasswordResetCodes.resetTokenHash, resetTokenHash),
      isNotNull(authPasswordResetCodes.verifiedAt), isNull(authPasswordResetCodes.consumedAt), gt(authPasswordResetCodes.expiresAt, now),
    )).limit(1);
    return row ?? null;
  }

  async completePasswordReset(input: { accountId: string; codeId: string; passwordHash: string; now: Date }): Promise<boolean> {
    return this.db.transaction(async tx => {
      const [consumed] = await tx.update(authPasswordResetCodes).set({ consumedAt: input.now })
        .where(and(eq(authPasswordResetCodes.id, input.codeId), isNull(authPasswordResetCodes.consumedAt)))
        .returning({ id: authPasswordResetCodes.id });
      if (!consumed) return false;
      await tx.update(authAccounts).set({ passwordHash: input.passwordHash, updatedAt: input.now }).where(eq(authAccounts.id, input.accountId));
      await tx.update(authSessions).set({ revokedAt: input.now })
        .where(and(eq(authSessions.accountId, input.accountId), isNull(authSessions.revokedAt)));
      return true;
    });
  }
}
