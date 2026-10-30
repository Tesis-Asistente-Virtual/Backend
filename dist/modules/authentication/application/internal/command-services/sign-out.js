import { z } from 'zod';
import { InvalidRefreshToken } from './refresh-session.js';
export const signOutSchema = z.object({ refreshToken: z.string().min(1).max(512) }).strict();
export class SignOut {
    sessions;
    tokens;
    constructor(sessions, tokens) {
        this.sessions = sessions;
        this.tokens = tokens;
    }
    async execute(input) {
        const { refreshToken } = signOutSchema.parse(input);
        const revoked = await this.sessions.revokeByHash(this.tokens.hash(refreshToken), new Date());
        if (!revoked)
            throw new InvalidRefreshToken();
    }
}
