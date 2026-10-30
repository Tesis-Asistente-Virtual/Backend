import { verify } from 'argon2';
import { z } from 'zod';
import { normalizeEmail } from '../../../domain/model/auth-account.js';
export const signInSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1) }).strict();
export class InvalidCredentials extends Error {
}
export class SignIn {
    accounts;
    sessions;
    accessTokens;
    refreshTokens;
    accessTokenTtlSeconds;
    refreshTokenTtlSeconds;
    constructor(accounts, sessions, accessTokens, refreshTokens, accessTokenTtlSeconds, refreshTokenTtlSeconds) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.accessTokens = accessTokens;
        this.refreshTokens = refreshTokens;
        this.accessTokenTtlSeconds = accessTokenTtlSeconds;
        this.refreshTokenTtlSeconds = refreshTokenTtlSeconds;
    }
    async execute(input) {
        const data = signInSchema.parse(input);
        const account = await this.accounts.findCredentialsByEmail(normalizeEmail(data.email));
        if (!account || account.status !== 'active' || !(await verify(account.passwordHash, data.password)))
            throw new InvalidCredentials();
        const refresh = this.refreshTokens.generate();
        const expiresAt = new Date(Date.now() + this.refreshTokenTtlSeconds * 1000);
        await this.sessions.create({ accountId: account.id, refreshTokenHash: refresh.hash, expiresAt });
        const accessToken = await this.accessTokens.issue(account.id);
        return { accessToken, refreshToken: refresh.token, tokenType: 'Bearer', expiresIn: this.accessTokenTtlSeconds };
    }
}
