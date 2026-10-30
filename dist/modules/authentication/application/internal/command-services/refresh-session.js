import { z } from 'zod';
export const refreshSessionSchema = z.object({ refreshToken: z.string().min(1).max(512) }).strict();
export class InvalidRefreshToken extends Error {
}
export class RefreshSession {
    sessions;
    jwt;
    tokens;
    accessTtl;
    refreshTtl;
    constructor(sessions, jwt, tokens, accessTtl, refreshTtl) {
        this.sessions = sessions;
        this.jwt = jwt;
        this.tokens = tokens;
        this.accessTtl = accessTtl;
        this.refreshTtl = refreshTtl;
    }
    async execute(input) {
        const { refreshToken } = refreshSessionSchema.parse(input);
        const oldHash = this.tokens.hash(refreshToken);
        const now = new Date();
        const session = await this.sessions.findByRefreshTokenHash(oldHash);
        if (!session || session.revokedAt || session.expiresAt <= now || session.accountStatus !== 'active')
            throw new InvalidRefreshToken();
        const replacement = this.tokens.generate();
        const accessToken = await this.jwt.issue(session.accountId);
        const accountId = await this.sessions.rotate(oldHash, replacement.hash, new Date(now.getTime() + this.refreshTtl * 1000), now);
        if (!accountId)
            throw new InvalidRefreshToken();
        return { accessToken, refreshToken: replacement.token, tokenType: 'Bearer', expiresIn: this.accessTtl };
    }
}
