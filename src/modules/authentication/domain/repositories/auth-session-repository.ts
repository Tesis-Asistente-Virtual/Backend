export interface CreateAuthSession { accountId: string; refreshTokenHash: string; expiresAt: Date }
export interface AuthSessionRecord { id: string; accountId: string; expiresAt: Date; revokedAt: Date | null; accountStatus: string }
export interface AuthSessionRepository {
  create(session: CreateAuthSession): Promise<void>;
  findByRefreshTokenHash(hash: string): Promise<AuthSessionRecord | null>;
  rotate(hash: string, replacementHash: string, expiresAt: Date, now: Date): Promise<string | null>;
  revokeByHash(hash: string, revokedAt: Date): Promise<boolean>;
}
