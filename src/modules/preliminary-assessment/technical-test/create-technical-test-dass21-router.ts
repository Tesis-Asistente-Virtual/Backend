import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../shared/infrastructure/database/schema.js';
import type { JwtAccessTokenService } from '../../authentication/infrastructure/security/jwt-access-token-service.js';
import { validateTestDatabaseUrl } from '../../../shared/infrastructure/database/test-database-safety.js';
import { DrizzleInstrumentCatalog } from '../infrastructure/persistence/drizzle-instrument-catalog.js';
import { DrizzlePreliminaryAssessmentRepository } from '../infrastructure/persistence/drizzle-preliminary-assessment-repository.js';
import { DrizzleAssessmentResponseRepository } from '../infrastructure/persistence/drizzle-assessment-response-repository.js';
import { isTechnicalTestDass21Candidate } from './dass21-candidate-fixture.js';
import { TechnicalTestDass21Catalog } from './technical-test-dass21-catalog.js';
import { composePreliminaryAssessmentRouter } from '../interfaces/rest/preliminary-assessment-router-composition.js';
import { DASS21_SPANISH_CANDIDATE, DASS21_SPANISH_CANDIDATE_VERSION } from '../domain/model/dass21-spanish-candidate.js';
import { TECHNICAL_TEST_DASS21_VERSION_ID } from './dass21-candidate-fixture.js';
import { TECHNICAL_TEST_DASS21_VERSION } from './dass21-candidate-fixture.js';
import { DrizzleDass21QuestionMappingRepository } from '../infrastructure/persistence/drizzle-dass21-question-mapping-repository.js';
import { DrizzleDass21AssessmentScoreRepository } from '../infrastructure/persistence/drizzle-dass21-assessment-score-repository.js';
import { ScoreCompletedDass21Assessment } from '../application/internal/command-services/score-completed-dass21-assessment.js';
import { ConsentAssessmentAuthorizer } from '../infrastructure/persistence/consent-assessment-authorizer.js';
import { DrizzleConsentRepository } from '../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { DrizzleDass21InternalResultReadUnitOfWork } from '../infrastructure/persistence/drizzle-dass21-internal-result-read-unit-of-work.js';
import { GetMyTechnicalTestDass21Result } from './get-my-technical-test-dass21-result.js';
import { ensureDass21TechnicalTestMapping, TECHNICAL_TEST_DASS21_MAPPING_VERSION } from './ensure-dass21-technical-test-mapping.js';
import { isStagingLoopbackAddress, validateStagingDatabaseUrl } from '../../../shared/infrastructure/database/staging-database-safety.js';

/**
 * Test-only router factory. The URL and connected server are both verified;
 * the standard application never imports or mounts this module.
 */
export async function createTechnicalTestDass21Router(database: NodePgDatabase<typeof schema>, jwt: JwtAccessTokenService) {
  validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  return createGuardedTechnicalDass21Router(database, jwt, 'tesis_test_db');
}

/** Candidate-only router for the dedicated synthetic staging entrypoint. */
export async function createSyntheticStagingDass21Router(
  database: NodePgDatabase<typeof schema>, jwt: JwtAccessTokenService, stagingDatabaseUrl: string | undefined,
) {
  validateStagingDatabaseUrl(stagingDatabaseUrl);
  return createGuardedTechnicalDass21Router(database, jwt, 'tesis_staging_db');
}

async function createGuardedTechnicalDass21Router(
  database: NodePgDatabase<typeof schema>, jwt: JwtAccessTokenService, expectedDatabase: 'tesis_test_db' | 'tesis_staging_db',
) {
  const identity = await database.execute(sql`SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address`);
  const target = identity.rows[0] as { database_name: string; server_address: string | null } | undefined;
  const address = target?.server_address?.replace(/\/(?:32|128)$/, '');
  if (!target || target.database_name !== expectedDatabase || !['127.0.0.1', '::1'].includes(address ?? '') ||
      (expectedDatabase === 'tesis_staging_db' && !isStagingLoopbackAddress(target.server_address))) {
    throw new Error(`DASS-21 technical composition requires a loopback ${expectedDatabase} connection`);
  }
  const underlyingCatalog = new DrizzleInstrumentCatalog(database);
  const technicalCatalog = new TechnicalTestDass21Catalog(underlyingCatalog);
  const candidate = await technicalCatalog.findAvailableByVersionId(TECHNICAL_TEST_DASS21_VERSION_ID, new Date());
  if (!candidate || candidate.version !== TECHNICAL_TEST_DASS21_VERSION) {
    throw new Error('The exact pending DASS-21 candidate is unavailable to the technical-test composition');
  }
  await ensureDass21TechnicalTestMapping(database, candidate);
  const availability = isTechnicalTestDass21Candidate;
  const mappingRepository = new DrizzleDass21QuestionMappingRepository(database, availability, TECHNICAL_TEST_DASS21_VERSION_ID);
  const score = new ScoreCompletedDass21Assessment(
    new DrizzlePreliminaryAssessmentRepository(database, TECHNICAL_TEST_DASS21_VERSION_ID),
    technicalCatalog,
    mappingRepository,
    new DrizzleDass21AssessmentScoreRepository(database),
    new ConsentAssessmentAuthorizer(new DrizzleConsentRepository(database)),
    () => new Date(),
    availability,
    true,
  );
  const technicalResult = new GetMyTechnicalTestDass21Result(
    new DrizzleDass21InternalResultReadUnitOfWork(database, availability), availability,
  );
  return composePreliminaryAssessmentRouter(
    database,
    jwt,
    isTechnicalTestDass21Candidate,
    technicalCatalog,
    instrumentVersionId => instrumentVersionId === TECHNICAL_TEST_DASS21_VERSION_ID ? {
      technicalAvailability: 'technical_test_only',
      candidateVersion: DASS21_SPANISH_CANDIDATE_VERSION,
      professionalReviewStatus: DASS21_SPANISH_CANDIDATE.professionalReviewStatus,
      approvalStatus: DASS21_SPANISH_CANDIDATE.approvalStatus,
      instructionsOriginal: DASS21_SPANISH_CANDIDATE.instructionsOriginal,
      responseScaleHeadingOriginal: DASS21_SPANISH_CANDIDATE.responseScaleHeadingOriginal,
      referencePeriod: DASS21_SPANISH_CANDIDATE.referencePeriod,
    } : {},
    new DrizzlePreliminaryAssessmentRepository(database, TECHNICAL_TEST_DASS21_VERSION_ID),
    new DrizzleAssessmentResponseRepository(database, isTechnicalTestDass21Candidate, TECHNICAL_TEST_DASS21_VERSION_ID),
    {
      scoreCompleted: (assessmentId, accountId) => score.execute(accountId, {
        assessmentId, mappingVersion: TECHNICAL_TEST_DASS21_MAPPING_VERSION,
      }),
      getResult: (assessmentId, accountId) => technicalResult.execute(assessmentId, accountId),
    },
  );
}
