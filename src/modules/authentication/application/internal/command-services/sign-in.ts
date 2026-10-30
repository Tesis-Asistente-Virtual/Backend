import { verify } from 'argon2';
import { z } from 'zod';
import { normalizeEmail } from '../../../domain/model/auth-account.js';
import type { AuthAccountRepository } from '../../../domain/repositories/auth-account-repository.js';
import type { AuthSessionRepository } from '../../../domain/repositories/auth-session-repository.js';

export const signInSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1) }).strict();
export class InvalidCredentials extends Error {}
export type AccessTokenIssuer = { issue(accountId: string): Promise<string> };
export type RefreshTokenGenerator = { generate(): { token: string; hash: string } };

export class SignIn {
  constructor(private readonly accounts: AuthAccountRepository, private readonly sessions: AuthSessionRepository, private readonly accessTokens: AccessTokenIssuer, private readonly refreshTokens: RefreshTokenGenerator, private readonly accessTokenTtlSeconds: number, private readonly refreshTokenTtlSeconds: number) {}

  async execute(input: unknown) {
    const data = signInSchema.parse(input);
    const account = await this.accounts.findCredentialsByEmail(normalizeEmail(data.email));
    if (!account || account.status !== 'active' || !(await verify(account.passwordHash, data.password))) throw new InvalidCredentials();

    const refresh = this.refreshTokens.generate();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlSeconds * 1000);
    await this.sessions.create({ accountId: account.id, refreshTokenHash: refresh.hash, expiresAt });
    const accessToken = await this.accessTokens.issue(account.id);
    return { accessToken, refreshToken: refresh.token, tokenType: 'Bearer' as const, expiresIn: this.accessTokenTtlSeconds };
  }
}
