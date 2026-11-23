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
import { GetMyAssessmentForm } from '../../application/internal/query-services/get-my-assessment-form.js';
import { StartPreliminaryAssessment } from '../../application/internal/command-services/start-preliminary-assessment.js';
import { SubmitAssessmentResponse } from '../../application/internal/command-services/submit-assessment-response.js';
import { ChangeAssessmentState, PauseAssessment, ResumeAssessment, WithdrawAssessment } from '../../application/internal/command-services/change-assessment-state.js';
import { CompleteAssessment } from '../../application/internal/command-services/complete-preliminary-assessment.js';
import { ReauthorizeAssessment } from '../../application/internal/command-services/reauthorize-assessment.js';
import { PreliminaryAssessmentController } from './resources/preliminary-assessment-controller.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy } from '../../domain/model/instrument.js';
import type { InstrumentCatalog } from '../../domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentRepository } from '../../domain/repositories/preliminary-assessment-repository.js';
import type { AssessmentResponseRepository } from '../../domain/repositories/assessment-response-repository.js';
import type { ScoreCompletedDass21Assessment } from '../../application/internal/command-services/score-completed-dass21-assessment.js';
import type { GetMyTechnicalTestDass21Result } from '../../technical-test/get-my-technical-test-dass21-result.js';
import { TECHNICAL_TEST_DASS21_MAPPING_VERSION } from '../../technical-test/ensure-dass21-technical-test-mapping.js';

export function composePreliminaryAssessmentRouter(
  database: NodePgDatabase<typeof schema> | null,
  jwt: JwtAccessTokenService | null,
  availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
  catalogOverride?: InstrumentCatalog,
  formMetadata?: (instrumentVersionId: string) => Readonly<Record<string, unknown>>,
  assessmentRepositoryOverride?: PreliminaryAssessmentRepository,
  responseRepositoryOverride?: AssessmentResponseRepository,
  technicalDass21?: { score: ScoreCompletedDass21Assessment; result: GetMyTechnicalTestDass21Result },
) {
  const router = Router();
  if (!database || !jwt) {
    for (const [method, path] of [
      ['get', '/info'], ['post', '/'], ['get', '/'], ['get', '/:id/form'], ['post', '/:id/reauthorize'], ['get', '/:id'], ['post', '/:id/responses'],
      ['post', '/:id/pause'], ['post', '/:id/resume'], ['post', '/:id/withdraw'],
      ['post', '/:id/complete'], ['get', '/:id/result'],
    ] as const) {
      router[method](path, (_req, _res, next) => next(new Error('Preliminary assessment dependencies are not configured')));
    }
    return router;
  }

  const assessments = assessmentRepositoryOverride ?? new DrizzlePreliminaryAssessmentRepository(database);
  const responses = responseRepositoryOverride ?? new DrizzleAssessmentResponseRepository(database, availability);
  const results = new DrizzleAssessmentResultRepository(database);
  const instruments = catalogOverride ?? new DrizzleInstrumentCatalog(database);
  const consent = new ConsentAssessmentAuthorizer(new DrizzleConsentRepository(database));
  const controller = new PreliminaryAssessmentController(
    new GetAssessmentInfo(instruments, () => new Date(), availability),
    new StartPreliminaryAssessment(assessments, instruments, consent, () => new Date(), availability),
    new ListMyAssessments(assessments, consent),
    new GetMyAssessment(assessments, consent),
    new GetMyAssessmentForm(assessments, instruments, consent, () => new Date(), availability),
    new SubmitAssessmentResponse(assessments, responses, instruments, consent, () => new Date(), availability),
    new PauseAssessment(new ChangeAssessmentState(assessments, consent)),
    new ResumeAssessment(new ChangeAssessmentState(assessments, consent)),
    new WithdrawAssessment(new ChangeAssessmentState(assessments, consent)),
    new CompleteAssessment(assessments, results, instruments, consent, () => new Date(), availability),
    new ReauthorizeAssessment(assessments, consent),
    new GetMyAssessmentResult(assessments, results),
    formMetadata,
    technicalDass21 ? {
      scoreCompleted: (assessmentId, accountId) => technicalDass21.score.execute(accountId, {
        assessmentId, mappingVersion: TECHNICAL_TEST_DASS21_MAPPING_VERSION,
      }),
      getResult: (assessmentId, accountId) => technicalDass21.result.execute(assessmentId, accountId),
    } : undefined,
  );
  const auth = authenticationMiddleware(jwt);
  router.get('/info', auth, (req, res, next) => { void controller.assessmentInfo(req, res).catch(next); });
  router.post('/', auth, (req, res, next) => { void controller.startAssessment(req, res).catch(next); });
  router.get('/', auth, (req, res, next) => { void controller.listAssessments(req, res).catch(next); });
  router.get('/:id/form', auth, (req, res, next) => { void controller.getAssessmentForm(req, res).catch(next); });
  router.post('/:id/reauthorize', auth, (req, res, next) => { void controller.reauthorize(req, res).catch(next); });
  router.post('/:id/responses', auth, (req, res, next) => { void controller.submit(req, res).catch(next); });
  router.post('/:id/pause', auth, (req, res, next) => { void controller.pause(req, res).catch(next); });
  router.post('/:id/resume', auth, (req, res, next) => { void controller.resume(req, res).catch(next); });
  router.post('/:id/withdraw', auth, (req, res, next) => { void controller.withdraw(req, res).catch(next); });
  router.post('/:id/complete', auth, (req, res, next) => { void controller.complete(req, res).catch(next); });
  router.get('/:id/result', auth, (req, res, next) => { void controller.result(req, res).catch(next); });
  router.get('/:id', auth, (req, res, next) => { void controller.getAssessment(req, res).catch(next); });
  return router;
}
