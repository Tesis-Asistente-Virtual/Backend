import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../../../config/env.js';
export class JwtAccessTokenService {
    secret;
    issuer;
    audience;
    ttlSeconds;
    key;
    constructor(secret, issuer, audience, ttlSeconds) {
        this.secret = secret;
        this.issuer = issuer;
        this.audience = audience;
        this.ttlSeconds = ttlSeconds;
        this.key = new TextEncoder().encode(secret);
    }
    async issue(accountId) {
        return new SignJWT({})
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject(accountId)
            .setIssuer(this.issuer)
            .setAudience(this.audience)
            .setIssuedAt()
            .setExpirationTime(`${this.ttlSeconds}s`)
            .sign(this.key);
    }
    async verify(token) {
        try {
            const { payload } = await jwtVerify(token, this.key, {
                algorithms: ['HS256'],
                issuer: this.issuer,
                audience: this.audience,
            });
            if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number' || typeof payload.exp !== 'number')
                return null;
            return { sub: payload.sub, iat: payload.iat, exp: payload.exp };
        }
        catch {
            return null;
        }
    }
    static fromEnvironment() {
        return env.jwtSecret ? new JwtAccessTokenService(env.jwtSecret, env.jwtIssuer, env.jwtAudience, env.accessTokenTtlSeconds) : null;
    }
}
