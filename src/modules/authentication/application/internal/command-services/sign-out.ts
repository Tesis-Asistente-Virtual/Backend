import { z } from 'zod';
import type { AuthSessionRepository } from '../../../domain/repositories/auth-session-repository.js';
import type { RefreshTokenGenerator } from './sign-in.js';
import { InvalidRefreshToken } from './refresh-session.js';

export const signOutSchema = z.object({ refreshToken: z.string().min(1).max(512) }).strict();
export class SignOut {
  constructor(private readonly sessions: AuthSessionRepository, private readonly tokens: RefreshTokenGenerator & { hash(token: string): string }) {}
  async execute(input: unknown): Promise<void> {
    const { refreshToken } = signOutSchema.parse(input);
    const revoked = await this.sessions.revokeByHash(this.tokens.hash(refreshToken), new Date());
    if (!revoked) throw new InvalidRefreshToken();
  }
}
