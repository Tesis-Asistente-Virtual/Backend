import { Router } from 'express';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import type { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import type { PsychologicalReferralService } from '../../application/internal/psychological-referral-service.js';
import { ReferralFeatureUnavailable } from '../../application/referral-errors.js';
import { PsychologicalReferralController } from './psychological-referral-controller.js';

export function createPsychologicalReferralRouter(
  jwt: JwtAccessTokenService | null,
  service: PsychologicalReferralService | null,
) {
  const router = Router();
  const controller = new PsychologicalReferralController(service);
  if (!jwt) {
    router.post('/', (_req, _res, next) => next(new ReferralFeatureUnavailable()));
    router.get('/:id', (_req, _res, next) => next(new ReferralFeatureUnavailable()));
    router.post('/:id/send', (_req, _res, next) => next(new ReferralFeatureUnavailable()));
    router.delete('/:id', (_req, _res, next) => next(new ReferralFeatureUnavailable()));
    return router;
  }
  router.post('/', authenticationMiddleware(jwt), (req, res, next) => { void controller.create(req, res).catch(next); });
  router.get('/:id', authenticationMiddleware(jwt), (req, res, next) => { void controller.get(req, res).catch(next); });
  router.post('/:id/send', authenticationMiddleware(jwt), (req, res, next) => { void controller.send(req, res).catch(next); });
  router.delete('/:id', authenticationMiddleware(jwt), (req, res, next) => { void controller.cancel(req, res).catch(next); });
  return router;
}
