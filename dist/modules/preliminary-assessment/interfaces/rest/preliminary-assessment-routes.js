import { db } from '../../../../shared/infrastructure/database/client.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { createPreliminaryAssessmentRouter } from './create-preliminary-assessment-router.js';
export const preliminaryAssessmentsRouter = createPreliminaryAssessmentRouter(db, JwtAccessTokenService.fromEnvironment());
