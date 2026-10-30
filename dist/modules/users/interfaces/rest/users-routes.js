import { Router } from 'express';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { DrizzleUserProfileRepository } from '../../infrastructure/persistence/drizzle-user-profile-repository.js';
import { GetMyProfile } from '../../application/internal/query-services/get-my-profile.js';
import { MyProfileController } from './resources/my-profile-controller.js';
import { UpdateMyProfile } from '../../application/internal/command-services/update-my-profile.js';
const router = Router();
const jwt = JwtAccessTokenService.fromEnvironment();
if (db && jwt) {
    const profiles = new DrizzleUserProfileRepository(db);
    const controller = new MyProfileController(new GetMyProfile(profiles), new UpdateMyProfile(profiles));
    router.get('/me', authenticationMiddleware(jwt), (req, res, next) => { void controller.handle(req, res).catch(next); });
    router.patch('/me', authenticationMiddleware(jwt), (req, res, next) => { void controller.update(req, res).catch(next); });
}
else {
    router.get('/me', (_req, _res, next) => next(new Error('Profile dependencies are not configured')));
    router.patch('/me', (_req, _res, next) => next(new Error('Profile dependencies are not configured')));
}
export const usersRouter = router;
