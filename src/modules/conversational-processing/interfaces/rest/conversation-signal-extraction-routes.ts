import { Router } from 'express';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzleConversationRepository } from '../../../conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../../conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { OpenAiConfigurationError } from '../../../conversations/infrastructure/openai/openai-configuration.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { CheckConsentForPurpose } from '../../../consent/application/internal/query-services/check-consent-for-purpose.js';
import { OpenAiConversationSignalExtractor } from '../../infrastructure/openai/openai-conversation-signal-extractor.js';
import { ConversationSignalExtractionError, type ConversationSignalExtractor } from '../../application/ports/conversation-signal-extractor.js';
import { ExtractAuthorizedConversationSignals, SignalExtractionUnavailable } from '../../application/internal/command-services/extract-authorized-conversation-signals.js';
import { ConversationSignalExtractionController, type ConversationSignalExtractionService } from './conversation-signal-extraction-controller.js';

export function createConversationSignalExtractionRouter(
  extraction: ConversationSignalExtractionService | null,
  jwt: JwtAccessTokenService | null,
) {
  const router = Router();
  const controller = new ConversationSignalExtractionController(extraction);
  if (jwt) {
    router.post('/:id/signals/extract', authenticationMiddleware(jwt), (req, res, next) => {
      void controller.execute(req, res).catch(next);
    });
    router.post('/:id/signals/results', authenticationMiddleware(jwt), (req, res, next) => {
      void controller.generateResult(req, res).catch(next);
    });
  } else {
    router.post('/:id/signals/extract', (_req, _res, next) => next(new SignalExtractionUnavailable()));
    router.post('/:id/signals/results', (_req, _res, next) => next(new SignalExtractionUnavailable()));
  }
  return router;
}

function createProductionExtraction(): ConversationSignalExtractionService | null {
  if (!db) return null;
  let extractor: ConversationSignalExtractor;
  try {
    extractor = new OpenAiConversationSignalExtractor();
  } catch (error) {
    if (!(error instanceof OpenAiConfigurationError)) throw error;
    // Keep the API and the rest of the backend available when optional AI config is absent.
    extractor = { extract: async () => { throw new ConversationSignalExtractionError('provider_unavailable'); } };
  }
  return new ExtractAuthorizedConversationSignals(
    new DrizzleConversationRepository(db),
    new DrizzleConversationMessageRepository(db),
    new CheckConsentForPurpose(new DrizzleConsentRepository(db)),
    extractor,
  );
}

export const conversationSignalExtractionRouter = createConversationSignalExtractionRouter(
  createProductionExtraction(),
  JwtAccessTokenService.fromEnvironment(),
);
