import { db } from '../../../../shared/infrastructure/database/client.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { createConsentRouter } from './create-consent-router.js';
/** Standard application composition; the isolated DASS-21 test entrypoint injects its guarded test DB separately. */
export const consentRouter = createConsentRouter(db, JwtAccessTokenService.fromEnvironment());
