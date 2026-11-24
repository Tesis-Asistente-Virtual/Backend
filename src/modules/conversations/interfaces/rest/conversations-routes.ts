import { Router } from 'express';
import { db, pool } from '../../../../shared/infrastructure/database/client.js';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzleConversationMessageRepository } from '../../infrastructure/persistence/drizzle-conversation-message-repository.js';
import { DrizzleConversationRepository } from '../../infrastructure/persistence/drizzle-conversation-repository.js';
import { CreateConversation } from '../../application/internal/command-services/create-conversation.js';
import { GetConversation } from '../../application/internal/query-services/get-conversation.js';
import { ListConversationMessages } from '../../application/internal/query-services/list-conversation-messages.js';
import { ListConversations } from '../../application/internal/query-services/list-conversations.js';
import { ConversationsController } from './resources/conversations-controller.js';
import { OpenAiTextGenerator } from '../../infrastructure/openai/openai-text-generator.js';
import { OpenAiConfigurationError } from '../../infrastructure/openai/openai-configuration.js';
import { PostgresConversationTurnLock } from '../../infrastructure/persistence/postgres-conversation-turn-lock.js';
import { SendConversationMessage } from '../../application/internal/command-services/send-conversation-message.js';
import { StreamConversationMessage } from '../../application/internal/command-services/stream-conversation-message.js';
import { env } from '../../../../config/env.js';
import { ConsoleConversationStreamObserver } from '../../infrastructure/observability/console-conversation-stream-observer.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { CheckConsentForPurpose } from '../../../consent/application/internal/query-services/check-consent-for-purpose.js';
import { ConsentConversationProcessingAuthorizer } from '../../infrastructure/persistence/consent-conversation-processing-authorizer.js';
import { DeleteMyConversation } from '../../application/internal/command-services/delete-my-conversation.js';

const router = Router();
const jwt = JwtAccessTokenService.fromEnvironment();
if (db && pool && jwt) {
  const conversations = new DrizzleConversationRepository(db);
  const messages = new DrizzleConversationMessageRepository(db);
  const turnLock = new PostgresConversationTurnLock(pool);
  const conversationConsent = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(new DrizzleConsentRepository(db)));
  let sendMessage: SendConversationMessage | undefined;
  let streamMessage: StreamConversationMessage | undefined;
  try {
    const generator = new OpenAiTextGenerator(env);
    sendMessage = new SendConversationMessage(
      conversations,
      messages,
      generator,
      turnLock,
      env.openAiMaxContextMessages,
      env.openAiMaxOutputTokens,
      conversationConsent,
    );
    streamMessage = new StreamConversationMessage(
      conversations,
      messages,
      generator,
      turnLock,
      env.openAiMaxContextMessages,
      env.openAiMaxOutputTokens,
      conversationConsent,
      new ConsoleConversationStreamObserver(),
    );
  } catch (error) {
    if (!(error instanceof OpenAiConfigurationError)) throw error;
  }
  const controller = new ConversationsController(
    new CreateConversation(conversations),
    new ListConversations(conversations),
    new GetConversation(conversations),
    new ListConversationMessages(conversations, messages),
    sendMessage,
    streamMessage,
    new DeleteMyConversation(conversations, turnLock),
  );
  router.post('/', authenticationMiddleware(jwt), (req, res, next) => { void controller.create(req, res).catch(next); });
  router.get('/', authenticationMiddleware(jwt), (req, res, next) => { void controller.list(req, res).catch(next); });
  router.get('/:id/messages', authenticationMiddleware(jwt), (req, res, next) => { void controller.listConversationMessages(req, res).catch(next); });
  router.post('/:id/messages', authenticationMiddleware(jwt), (req, res, next) => { void controller.sendConversationMessage(req, res).catch(next); });
  router.post('/:id/messages/stream', authenticationMiddleware(jwt), (req, res, next) => { void controller.streamConversationMessage(req, res).catch(next); });
  router.get('/:id', authenticationMiddleware(jwt), (req, res, next) => { void controller.get(req, res).catch(next); });
  router.delete('/:id', authenticationMiddleware(jwt), (req, res, next) => { void controller.delete(req, res).catch(next); });
} else {
  for (const method of ['post', 'get'] as const) {
    router[method]('/', (_req, _res, next) => next(new Error('Conversation dependencies are not configured')));
  }
  router.get('/:id/messages', (_req, _res, next) => next(new Error('Conversation dependencies are not configured')));
  router.post('/:id/messages', (_req, _res, next) => next(new Error('Conversation dependencies are not configured')));
  router.post('/:id/messages/stream', (_req, _res, next) => next(new Error('Conversation dependencies are not configured')));
  router.get('/:id', (_req, _res, next) => next(new Error('Conversation dependencies are not configured')));
  router.delete('/:id', (_req, _res, next) => next(new Error('Conversation dependencies are not configured')));
}
export const conversationsRouter = router;
