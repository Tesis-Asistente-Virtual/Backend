import { Router } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import type { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { ConsentMonitoringAuthorizer } from '../../infrastructure/persistence/consent-monitoring-authorizer.js';
import { DrizzleMonitoringEnrollmentRepository } from '../../infrastructure/persistence/drizzle-monitoring-enrollment-repository.js';
import { DrizzleMonitoringSessionRepository } from '../../infrastructure/persistence/drizzle-monitoring-session-repository.js';
import { GetMonitoringInfo } from '../../application/internal/query-services/get-monitoring-info.js';
import { ListMyMonitoringEnrollments } from '../../application/internal/query-services/list-my-monitoring-enrollments.js';
import { GetMyMonitoringEnrollment } from '../../application/internal/query-services/get-my-monitoring-enrollment.js';
import { ListMyMonitoringSessions } from '../../application/internal/query-services/list-my-monitoring-sessions.js';
import { StartMonitoringEnrollment } from '../../application/internal/command-services/start-monitoring-enrollment.js';
import { ChangeMonitoringEnrollmentState, PauseMonitoringEnrollment, ResumeMonitoringEnrollment, WithdrawMonitoringEnrollment, CompleteMonitoringEnrollment } from '../../application/internal/command-services/change-monitoring-enrollment-state.js';
import { CreateMonitoringSession } from '../../application/internal/command-services/create-monitoring-session.js';
import { MonitoringController } from './resources/monitoring-controller.js';

const routes = [
  ['get', '/info'],
  ['post', '/enrollments'],
  ['get', '/enrollments'],
  ['get', '/enrollments/:id'],
  ['post', '/enrollments/:id/pause'],
  ['post', '/enrollments/:id/resume'],
  ['post', '/enrollments/:id/withdraw'],
  ['post', '/enrollments/:id/complete'],
  ['post', '/enrollments/:id/sessions'],
  ['get', '/enrollments/:id/sessions'],
] as const;

export function createMonitoringRouter(database: NodePgDatabase<typeof schema> | null, jwt: JwtAccessTokenService | null) {
  const router = Router();
  if (!database || !jwt) {
    for (const [method, path] of routes) router[method](path, (_req, _res, next) => next(new Error('Monitoring dependencies are not configured')));
    return router;
  }

  const enrollments = new DrizzleMonitoringEnrollmentRepository(database);
  const sessions = new DrizzleMonitoringSessionRepository(database);
  const consent = new ConsentMonitoringAuthorizer(new DrizzleConsentRepository(database));
  const enrollmentState = new ChangeMonitoringEnrollmentState(enrollments, consent);
  const controller = new MonitoringController(
    new GetMonitoringInfo(),
    new StartMonitoringEnrollment(enrollments, consent),
    new ListMyMonitoringEnrollments(enrollments),
    new GetMyMonitoringEnrollment(enrollments),
    new PauseMonitoringEnrollment(enrollmentState),
    new ResumeMonitoringEnrollment(enrollmentState),
    new WithdrawMonitoringEnrollment(enrollmentState),
    new CompleteMonitoringEnrollment(enrollmentState),
    new CreateMonitoringSession(enrollments, sessions, consent),
    new ListMyMonitoringSessions(enrollments, sessions),
  );
  const auth = authenticationMiddleware(jwt);
  router.get('/info', auth, (req, res, next) => { void controller.monitoringInfo(req, res).catch(next); });
  router.post('/enrollments', auth, (req, res, next) => { void controller.startEnrollment(req, res).catch(next); });
  router.get('/enrollments', auth, (req, res, next) => { void controller.listEnrollments(req, res).catch(next); });
  router.post('/enrollments/:id/pause', auth, (req, res, next) => { void controller.pause(req, res).catch(next); });
  router.post('/enrollments/:id/resume', auth, (req, res, next) => { void controller.resume(req, res).catch(next); });
  router.post('/enrollments/:id/withdraw', auth, (req, res, next) => { void controller.withdraw(req, res).catch(next); });
  router.post('/enrollments/:id/complete', auth, (req, res, next) => { void controller.complete(req, res).catch(next); });
  router.post('/enrollments/:id/sessions', auth, (req, res, next) => { void controller.createSessionForEnrollment(req, res).catch(next); });
  router.get('/enrollments/:id/sessions', auth, (req, res, next) => { void controller.listSessionsForEnrollment(req, res).catch(next); });
  router.get('/enrollments/:id', auth, (req, res, next) => { void controller.getEnrollment(req, res).catch(next); });
  return router;
}
