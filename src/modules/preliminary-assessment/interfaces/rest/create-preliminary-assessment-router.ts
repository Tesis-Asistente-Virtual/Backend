import { Router } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import type { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { DrizzlePreliminaryAssessmentRepository } from '../../infrastructure/persistence/drizzle-preliminary-assessment-repository.js';
import { DrizzleAssessmentResponseRepository } from '../../infrastructure/persistence/drizzle-assessment-response-repository.js';
import { DrizzleAssessmentResultRepository } from '../../infrastructure/persistence/drizzle-assessment-result-repository.js';
import { DrizzleInstrumentCatalog } from '../../infrastructure/persistence/drizzle-instrument-catalog.js';
import { ConsentAssessmentAuthorizer } from '../../infrastructure/persistence/consent-assessment-authorizer.js';
import { GetAssessmentInfo } from '../../application/internal/query-services/get-assessment-info.js';
import { ListMyAssessments } from '../../application/internal/query-services/list-my-assessments.js';
import { GetMyAssessment } from '../../application/internal/query-services/get-my-assessment.js';
import { GetMyAssessmentResult } from '../../application/internal/query-services/get-my-assessment-result.js';
import { StartPreliminaryAssessment } from '../../application/internal/command-services/start-preliminary-assessment.js';
import { SubmitAssessmentResponse } from '../../application/internal/command-services/submit-assessment-response.js';
import { ChangeAssessmentState, PauseAssessment, ResumeAssessment, WithdrawAssessment } from '../../application/internal/command-services/change-assessment-state.js';
import { CompleteAssessment } from '../../application/internal/command-services/complete-preliminary-assessment.js';
import { PreliminaryAssessmentController } from './resources/preliminary-assessment-controller.js';

export function createPreliminaryAssessmentRouter(database: NodePgDatabase<typeof schema> | null, jwt: JwtAccessTokenService | null) {
  const router = Router();
  if (!database || !jwt) {
    for (const [method, path] of [
      ['get', '/info'], ['post', '/'], ['get', '/'], ['get', '/:id'], ['post', '/:id/responses'],
      ['post', '/:id/pause'], ['post', '/:id/resume'], ['post', '/:id/withdraw'],
      ['post', '/:id/complete'], ['get', '/:id/result'],
    ] as const) {
      router[method](path, (_req, _res, next) => next(new Error('Preliminary assessment dependencies are not configured')));
    }
    return router;
  }

  const assessments = new DrizzlePreliminaryAssessmentRepository(database);
  const responses = new DrizzleAssessmentResponseRepository(database);
  const results = new DrizzleAssessmentResultRepository(database);
  const instruments = new DrizzleInstrumentCatalog(database);
  const consent = new ConsentAssessmentAuthorizer(new DrizzleConsentRepository(database));
  const controller = new PreliminaryAssessmentController(
    new GetAssessmentInfo(instruments),
    new StartPreliminaryAssessment(assessments, instruments, consent),
    new ListMyAssessments(assessments),
    new GetMyAssessment(assessments),
    new SubmitAssessmentResponse(assessments, responses, instruments, consent),
    new PauseAssessment(new ChangeAssessmentState(assessments, consent)),
    new ResumeAssessment(new ChangeAssessmentState(assessments, consent)),
    new WithdrawAssessment(new ChangeAssessmentState(assessments, consent)),
    new CompleteAssessment(assessments, results, instruments, consent),
    new GetMyAssessmentResult(assessments, results),
  );
  const auth = authenticationMiddleware(jwt);
  router.get('/info', auth, (req, res, next) => { void controller.assessmentInfo(req, res).catch(next); });
  router.post('/', auth, (req, res, next) => { void controller.startAssessment(req, res).catch(next); });
  router.get('/', auth, (req, res, next) => { void controller.listAssessments(req, res).catch(next); });
  router.post('/:id/responses', auth, (req, res, next) => { void controller.submit(req, res).catch(next); });
  router.post('/:id/pause', auth, (req, res, next) => { void controller.pause(req, res).catch(next); });
  router.post('/:id/resume', auth, (req, res, next) => { void controller.resume(req, res).catch(next); });
  router.post('/:id/withdraw', auth, (req, res, next) => { void controller.withdraw(req, res).catch(next); });
  router.post('/:id/complete', auth, (req, res, next) => { void controller.complete(req, res).catch(next); });
  router.get('/:id/result', auth, (req, res, next) => { void controller.result(req, res).catch(next); });
  router.get('/:id', auth, (req, res, next) => { void controller.getAssessment(req, res).catch(next); });
  return router;
}
