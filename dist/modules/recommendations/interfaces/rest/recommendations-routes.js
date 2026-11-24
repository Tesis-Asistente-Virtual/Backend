import { Router } from 'express';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { env } from '../../../../config/env.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { OpenAiConfigurationError } from '../../../conversations/infrastructure/openai/openai-configuration.js';
import { OpenAiRecommendationGenerator } from '../../infrastructure/openai/openai-recommendation-generator.js';
import { DrizzleRecommendationRepository } from '../../infrastructure/persistence/drizzle-recommendation-repository.js';
import { RecommendationService } from '../../application/internal/recommendation-service.js';
import { RecommendationsUnavailable } from '../../application/recommendation-errors.js';
import { RecommendationsController } from './recommendations-controller.js';
function productionService() {
    if (!db)
        return null;
    const policy = {
        enabled: env.wellbeingRecommendationsEnabled,
        deployment: env.wellbeingRecommendationsDeployment,
        allowedAccountIds: env.wellbeingRecommendationsAllowedAccountIds,
    };
    let generator = null;
    if (policy.enabled && policy.deployment === 'authorized_pilot' && policy.allowedAccountIds.length > 0) {
        try {
            generator = new OpenAiRecommendationGenerator();
        }
        catch (error) {
            if (!(error instanceof OpenAiConfigurationError))
                throw error;
        }
    }
    return new RecommendationService(new DrizzleRecommendationRepository(db), generator, policy);
}
export function createRecommendationsRouter(jwt, service = productionService()) {
    const router = Router();
    if (!jwt) {
        router.post('/generate', (_req, _res, next) => next(new RecommendationsUnavailable()));
        router.get('/latest', (_req, _res, next) => next(new RecommendationsUnavailable()));
        return router;
    }
    const controller = new RecommendationsController(service);
    router.post('/generate', authenticationMiddleware(jwt), (req, res, next) => { void controller.generate(req, res).catch(next); });
    router.get('/latest', authenticationMiddleware(jwt), (req, res, next) => { void controller.latest(req, res).catch(next); });
    return router;
}
export const recommendationsRouter = createRecommendationsRouter(JwtAccessTokenService.fromEnvironment());
