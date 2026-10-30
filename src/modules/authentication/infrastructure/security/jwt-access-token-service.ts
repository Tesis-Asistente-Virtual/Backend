import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../../../config/env.js';

export class JwtAccessTokenService {
  private readonly key: Uint8Array;
  constructor(private readonly secret: string, private readonly issuer: string, private readonly audience: string, private readonly ttlSeconds: number) {
    this.key = new TextEncoder().encode(secret);
  }
  async issue(accountId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(accountId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }
  async verify(token: string): Promise<{ sub: string; iat: number; exp: number } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      });
      if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
      return { sub: payload.sub, iat: payload.iat, exp: payload.exp };
    } catch {
      return null;
    }
  }
  static fromEnvironment(): JwtAccessTokenService | null {
    return env.jwtSecret ? new JwtAccessTokenService(env.jwtSecret, env.jwtIssuer, env.jwtAudience, env.accessTokenTtlSeconds) : null;
  }
}
