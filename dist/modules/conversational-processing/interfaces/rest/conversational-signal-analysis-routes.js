import { Router } from 'express';
import { env } from '../../../../config/env.js';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { CheckConsentForPurpose } from '../../../consent/application/internal/query-services/check-consent-for-purpose.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { DrizzleConversationMessageRepository } from '../../../conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { DrizzleConversationRepository } from '../../../conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { OpenAiConfigurationError } from '../../../conversations/infrastructure/openai/openai-configuration.js';
import { DrizzleConversationalSignalAnalysisRepository } from '../../infrastructure/persistence/drizzle-conversational-signal-analysis-repository.js';
import { OpenAiConversationalSignalAnalyzer } from '../../infrastructure/openai/openai-conversational-signal-analyzer.js';
import { AnalyzeAuthorizedConversationSignals, GetMyConversationalSignalAnalysis, } from '../../application/internal/command-services/analyze-authorized-conversation-signals.js';
import { ConversationSignalAnalysisController } from './conversation-signal-analysis-controller.js';
import { ConversationalSignalAnalysisUnavailable } from '../../application/internal/command-services/analyze-authorized-conversation-signals.js';
function createProductionServices() {
    if (!db)
        return { command: null, query: null };
    const repository = new DrizzleConversationalSignalAnalysisRepository(db);
    const policy = env.conversationalSignalAnalysisPolicy;
    const query = new GetMyConversationalSignalAnalysis(repository, policy);
    try {
        const analyzer = new OpenAiConversationalSignalAnalyzer();
        const command = new AnalyzeAuthorizedConversationSignals(new DrizzleConversationRepository(db), new DrizzleConversationMessageRepository(db), new CheckConsentForPurpose(new DrizzleConsentRepository(db)), analyzer, repository, policy);
        return { command, query };
    }
    catch (error) {
        if (!(error instanceof OpenAiConfigurationError))
            throw error;
        return { command: null, query };
    }
}
export function createConversationalSignalAnalysisRouter(jwt, services = createProductionServices()) {
    const router = Router();
    const controller = new ConversationSignalAnalysisController(services.command, services.query);
    if (!jwt) {
        router.post('/conversations/:id/signals/analyze', (_req, _res, next) => next(new ConversationalSignalAnalysisUnavailable()));
        router.get('/me/conversational-signals/latest', (_req, _res, next) => next(new ConversationalSignalAnalysisUnavailable()));
        router.get('/me/conversational-signals/history', (_req, _res, next) => next(new ConversationalSignalAnalysisUnavailable()));
        return router;
    }
    router.post('/conversations/:id/signals/analyze', authenticationMiddleware(jwt), (req, res, next) => { void controller.analyze(req, res).catch(next); });
    router.get('/me/conversational-signals/latest', authenticationMiddleware(jwt), (req, res, next) => { void controller.latest(req, res).catch(next); });
    router.get('/me/conversational-signals/history', authenticationMiddleware(jwt), (req, res, next) => { void controller.history(req, res).catch(next); });
    return router;
}
export const conversationalSignalAnalysisRouter = createConversationalSignalAnalysisRouter(JwtAccessTokenService.fromEnvironment());
