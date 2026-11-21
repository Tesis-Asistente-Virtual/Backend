import { db } from '../../../../shared/infrastructure/database/client.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { createMonitoringRouter } from './create-monitoring-router.js';

export const monitoringRouter = createMonitoringRouter(db, JwtAccessTokenService.fromEnvironment());
