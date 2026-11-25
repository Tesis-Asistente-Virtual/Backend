export interface PasswordResetCode {
  readonly id: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly verifiedAt: Date | null;
}

export interface PasswordResetRepository {
  findActiveAccountByEmail(email: string): Promise<{ id: string } | null>;
  findLatestCodeCreatedAt(accountId: string): Promise<Date | null>;
  createCode(input: { accountId: string; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void>;
  consumeOpenCodes(accountId: string, now: Date): Promise<void>;
  findOpenCode(accountId: string, now: Date): Promise<PasswordResetCode | null>;
  incrementAttempts(codeId: string): Promise<void>;
  markVerified(codeId: string, resetTokenHash: string, now: Date): Promise<void>;
  findVerifiedCodeByTokenHash(accountId: string, resetTokenHash: string, now: Date): Promise<{ id: string } | null>;
  completePasswordReset(input: { accountId: string; codeId: string; passwordHash: string; now: Date }): Promise<boolean>;
}
