import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { JwtAccessTokenService } from '../../../modules/authentication/infrastructure/security/jwt-access-token-service.js';

declare global {
  namespace Express { interface Request { auth?: { accountId: string } } }
}

const uuidSchema = z.string().uuid();
export function authenticationMiddleware(jwt: JwtAccessTokenService): RequestHandler {
  return (req, res, next) => {
    const authorization = req.get('authorization');
    if (!authorization) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match?.[1]) { res.status(401).json({ error: 'Unauthorized' }); return; }
    void jwt.verify(match[1]).then(claims => {
      if (!claims || !uuidSchema.safeParse(claims.sub).success) { res.status(401).json({ error: 'Unauthorized' }); return; }
      req.auth = { accountId: claims.sub };
      next();
    }).catch(next);
  };
}
