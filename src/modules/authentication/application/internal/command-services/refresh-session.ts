import { z } from 'zod';
import type { AuthSessionRepository } from '../../../domain/repositories/auth-session-repository.js';
import type { AccessTokenIssuer, RefreshTokenGenerator } from './sign-in.js';

export const refreshSessionSchema = z.object({ refreshToken: z.string().min(1).max(512) }).strict();
export class InvalidRefreshToken extends Error {}
export class RefreshSession {
  constructor(private readonly sessions: AuthSessionRepository, private readonly jwt: AccessTokenIssuer, private readonly tokens: RefreshTokenGenerator & { hash(token: string): string }, private readonly accessTtl: number, private readonly refreshTtl: number) {}
  async execute(input: unknown) {
    const { refreshToken } = refreshSessionSchema.parse(input);
    const oldHash = this.tokens.hash(refreshToken);
    const now = new Date();
    const session = await this.sessions.findByRefreshTokenHash(oldHash);
    if (!session || session.revokedAt || session.expiresAt <= now || session.accountStatus !== 'active') throw new InvalidRefreshToken();
    const replacement = this.tokens.generate();
    const accessToken = await this.jwt.issue(session.accountId);
    const accountId = await this.sessions.rotate(oldHash, replacement.hash, new Date(now.getTime() + this.refreshTtl * 1000), now);
    if (!accountId) throw new InvalidRefreshToken();
    return { accessToken, refreshToken: replacement.token, tokenType: 'Bearer' as const, expiresIn: this.accessTtl };
  }
}
