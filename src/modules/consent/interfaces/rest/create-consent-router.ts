import { Router } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import type { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { DrizzleConsentRepository } from '../../infrastructure/persistence/drizzle-consent-repository.js';
import { ListAvailableConsentNotices } from '../../application/internal/query-services/list-available-consent-notices.js';
import { GetMyConsentStatus } from '../../application/internal/query-services/get-my-consent-status.js';
import { RecordMyConsentDecision } from '../../application/internal/command-services/record-my-consent-decision.js';
import { ConsentController } from './resources/consent-controller.js';

/** Dependency-injected Consent REST composition; it does not select a database itself. */
export function createConsentRouter(database: NodePgDatabase<typeof schema> | null, jwt: JwtAccessTokenService | null) {
  const router = Router();
  if (!database || !jwt) {
    router.get('/notices', (_req, _res, next) => next(new Error('Consent dependencies are not configured')));
    router.get('/me', (_req, _res, next) => next(new Error('Consent dependencies are not configured')));
    router.post('/me/decisions', (_req, _res, next) => next(new Error('Consent dependencies are not configured')));
    return router;
  }

  const repository = new DrizzleConsentRepository(database);
  const controller = new ConsentController(new ListAvailableConsentNotices(repository), new GetMyConsentStatus(repository), new RecordMyConsentDecision(repository));
  router.get('/notices', (req, res, next) => { void controller.listNotices(req, res).catch(next); });
  router.get('/me', authenticationMiddleware(jwt), (req, res, next) => { void controller.myStatus(req, res).catch(next); });
  router.post('/me/decisions', authenticationMiddleware(jwt), (req, res, next) => { void controller.decideForMe(req, res).catch(next); });
  return router;
}
