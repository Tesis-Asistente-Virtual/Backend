import { Router } from 'express';
import { SignUp } from '../../application/internal/command-services/sign-up.js';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { DrizzleSignUpUnitOfWork } from '../../infrastructure/persistence/drizzle-sign-up-unit-of-work.js';
import { SignUpController } from './resources/sign-up-controller.js';
const router = Router();
if (db) {
    const service = new SignUp(new DrizzleSignUpUnitOfWork(db));
    const controller = new SignUpController(service);
    router.post('/sign-up', (req, res, next) => {
        void controller.handle(req, res).catch(next);
    });
}
else {
    router.post('/sign-up', (_req, _res, next) => next(new Error('Database is not configured')));
}
export const authenticationRouter = router;
