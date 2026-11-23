import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import type { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { composePreliminaryAssessmentRouter } from './preliminary-assessment-router-composition.js';

/** Standard approved-only router used by the normal application composition. */
export function createPreliminaryAssessmentRouter(database: NodePgDatabase<typeof schema> | null, jwt: JwtAccessTokenService | null) {
  return composePreliminaryAssessmentRouter(database, jwt);
}
