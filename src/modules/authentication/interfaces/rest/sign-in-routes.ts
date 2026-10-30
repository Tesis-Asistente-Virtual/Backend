import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { SignIn } from '../../application/internal/command-services/sign-in.js';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { env } from '../../../../config/env.js';
import { DrizzleAuthAccountRepository } from '../../infrastructure/persistence/drizzle-auth-account-repository.js';
import { DrizzleAuthSessionRepository } from '../../infrastructure/persistence/drizzle-auth-session-repository.js';
import { JwtAccessTokenService } from '../../infrastructure/security/jwt-access-token-service.js';
import { OpaqueRefreshTokenGenerator } from '../../infrastructure/security/opaque-refresh-token-generator.js';
import { SignInController } from './resources/sign-in-controller.js';

const router = Router();
// The default store is process-local; multi-instance deployments need a shared store.
const signInRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts' },
});
router.post('/sign-in', signInRateLimit, (req, res, next) => {
  const jwt = JwtAccessTokenService.fromEnvironment();
  if (!db || !jwt) { next(new Error('Sign-in dependencies are not configured')); return; }
  const service = new SignIn(new DrizzleAuthAccountRepository(db), new DrizzleAuthSessionRepository(db), jwt, new OpaqueRefreshTokenGenerator(), env.accessTokenTtlSeconds, env.refreshTokenTtlSeconds);
  void new SignInController(service).handle(req, res).catch(next);
});

export const signInRouter = router;
