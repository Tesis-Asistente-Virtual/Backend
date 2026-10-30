import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { env } from '../../../../config/env.js';
import { DrizzleAuthSessionRepository } from '../../infrastructure/persistence/drizzle-auth-session-repository.js';
import { JwtAccessTokenService } from '../../infrastructure/security/jwt-access-token-service.js';
import { OpaqueRefreshTokenGenerator } from '../../infrastructure/security/opaque-refresh-token-generator.js';
import { RefreshSession } from '../../application/internal/command-services/refresh-session.js';
import { SignOut } from '../../application/internal/command-services/sign-out.js';
import { RefreshController } from './resources/refresh-controller.js';
import { SignOutController } from './resources/sign-out-controller.js';
const router = Router();
// Default memory store is process-local. Multi-instance deployments need a shared rate-limit store.
const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts' } });
router.post('/refresh', limiter, (req, res, next) => {
    const jwt = JwtAccessTokenService.fromEnvironment();
    if (!db || !jwt) {
        next(new Error('Session dependencies are not configured'));
        return;
    }
    const sessions = new DrizzleAuthSessionRepository(db);
    const tokens = new OpaqueRefreshTokenGenerator();
    void new RefreshController(new RefreshSession(sessions, jwt, tokens, env.accessTokenTtlSeconds, env.refreshTokenTtlSeconds)).handle(req, res).catch(next);
});
router.post('/sign-out', limiter, (req, res, next) => {
    if (!db) {
        next(new Error('Session dependencies are not configured'));
        return;
    }
    void new SignOutController(new SignOut(new DrizzleAuthSessionRepository(db), new OpaqueRefreshTokenGenerator())).handle(req, res).catch(next);
});
export const sessionRouter = router;
