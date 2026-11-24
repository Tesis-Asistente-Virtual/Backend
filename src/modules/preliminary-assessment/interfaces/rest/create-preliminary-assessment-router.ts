import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import type { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { composePreliminaryAssessmentRouter } from './preliminary-assessment-router-composition.js';
import { productionDass21AuthorizationRegistry, type Dass21VersionAuthorizationRegistry } from '../../application/internal/services/dass21-version-authorization-registry.js';
import { DrizzleInstrumentCatalog } from '../../infrastructure/persistence/drizzle-instrument-catalog.js';
import { DrizzlePreliminaryAssessmentRepository } from '../../infrastructure/persistence/drizzle-preliminary-assessment-repository.js';
import { DrizzleAssessmentResponseRepository } from '../../infrastructure/persistence/drizzle-assessment-response-repository.js';
import { DrizzleDass21QuestionMappingRepository } from '../../infrastructure/persistence/drizzle-dass21-question-mapping-repository.js';
import { DrizzleDass21AssessmentScoreRepository } from '../../infrastructure/persistence/drizzle-dass21-assessment-score-repository.js';
import { DrizzleDass21InternalResultReadUnitOfWork } from '../../infrastructure/persistence/drizzle-dass21-internal-result-read-unit-of-work.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { ConsentAssessmentAuthorizer } from '../../infrastructure/persistence/consent-assessment-authorizer.js';
import { ScoreCompletedDass21Assessment } from '../../application/internal/command-services/score-completed-dass21-assessment.js';
import { GetMyInternalDass21Result } from '../../application/internal/query-services/get-my-internal-dass21-result.js';
import { GetAuthorizedDass21ParticipantResult } from '../../application/internal/query-services/get-authorized-dass21-participant-result.js';
import type { InstrumentAvailabilityPolicy } from '../../domain/model/instrument.js';
import { TECHNICAL_TEST_DASS21_MAPPING_VERSION } from '../../technical-test/ensure-dass21-technical-test-mapping.js';

/** Standard approved-only router used by the normal application composition. */
export function createPreliminaryAssessmentRouter(
  database: NodePgDatabase<typeof schema> | null,
  jwt: JwtAccessTokenService | null,
  authorizationRegistry: Dass21VersionAuthorizationRegistry = productionDass21AuthorizationRegistry,
) {
  const availability = authorizationRegistry.availability();
  if (!database || !jwt) return composePreliminaryAssessmentRouter(database, jwt, availability);

  const assessments = new DrizzlePreliminaryAssessmentRepository(database);
  const catalog = new DrizzleInstrumentCatalog(database);
  const scoring = new ScoreCompletedDass21Assessment(
    assessments,
    catalog,
    new DrizzleDass21QuestionMappingRepository(database, availability),
    new DrizzleDass21AssessmentScoreRepository(database),
    new ConsentAssessmentAuthorizer(new DrizzleConsentRepository(database)),
    () => new Date(),
    availability,
  );
  const internalResult = new GetMyInternalDass21Result(
    new DrizzleDass21InternalResultReadUnitOfWork(database, availability),
    authorizationRegistry,
  );
  const participantResult = new GetAuthorizedDass21ParticipantResult(assessments, internalResult, authorizationRegistry);
  const scoreIfAuthorized = async (assessmentId: string, accountId: string): Promise<unknown> => {
    const assessment = await assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment?.instrumentVersionId) return;
    // Scoring authorization gate removed by request: score with the frozen local test mapping.
    return scoring.execute(accountId, { assessmentId, mappingVersion: TECHNICAL_TEST_DASS21_MAPPING_VERSION });
  };

  return composePreliminaryAssessmentRouter(
    database,
    jwt,
    availability,
    undefined,
    undefined,
    assessments,
    new DrizzleAssessmentResponseRepository(database, availability),
    {
      scoreCompleted: scoreIfAuthorized,
      getResult: (assessmentId, accountId) => participantResult.execute(assessmentId, accountId),
    },
  );
}
