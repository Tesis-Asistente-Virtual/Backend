import { Router } from 'express';
import { authenticationMiddleware } from '../../../../shared/infrastructure/http/authentication-middleware.js';
import { DrizzleConsentRepository } from '../../../consent/infrastructure/persistence/drizzle-consent-repository.js';
import { CheckConsentForPurpose } from '../../../consent/application/internal/query-services/check-consent-for-purpose.js';
import { ConsentConversationProcessingAuthorizer } from '../../infrastructure/persistence/consent-conversation-processing-authorizer.js';
import { DrizzleConversationRepository } from '../../infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../infrastructure/persistence/drizzle-conversation-message-repository.js';
import { PostgresConversationTurnLock } from '../../infrastructure/persistence/postgres-conversation-turn-lock.js';
import { CreateConversation } from '../../application/internal/command-services/create-conversation.js';
import { SendConversationMessage } from '../../application/internal/command-services/send-conversation-message.js';
import { StreamConversationMessage } from '../../application/internal/command-services/stream-conversation-message.js';
import { GetConversation } from '../../application/internal/query-services/get-conversation.js';
import { ListConversationMessages } from '../../application/internal/query-services/list-conversation-messages.js';
import { ListConversations } from '../../application/internal/query-services/list-conversations.js';
import { ConsoleConversationStreamObserver } from '../../infrastructure/observability/console-conversation-stream-observer.js';
import { ConversationsController } from './resources/conversations-controller.js';
export const syntheticStagingConversationTitle = 'Prueba sintética de conversación';
export const syntheticStagingUserMessage = '[SINTÉTICO] Me cuesta organizarme para mis exámenes y quiero conversar sobre manejo del tiempo.';
export function isAllowedSyntheticStagingConversationInput(path, body) {
    if (!body || typeof body !== 'object')
        return false;
    const value = body;
    if (path === '/')
        return value.title === undefined || value.title === null || value.title === syntheticStagingConversationTitle;
    if (path.endsWith('/messages') || path.endsWith('/messages/stream'))
        return value.content === syntheticStagingUserMessage;
    return false;
}
function requireFixedSyntheticBody(req, res, next) {
    if (req.method === 'POST' && isAllowedSyntheticStagingConversationInput(req.path, req.body)) {
        next();
        return;
    }
    res.status(400).json({ error: 'Only the fixed synthetic staging scenario is accepted' });
}
/** Dependency-injected conversations router used only by the synthetic staging entrypoint. */
export function createTechnicalStagingConversationsRouter(input) {
    const conversations = new DrizzleConversationRepository(input.database);
    const messages = new DrizzleConversationMessageRepository(input.database);
    const turnLock = new PostgresConversationTurnLock(input.pool);
    const consent = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(new DrizzleConsentRepository(input.database)));
    const controller = new ConversationsController(new CreateConversation(conversations), new ListConversations(conversations), new GetConversation(conversations), new ListConversationMessages(conversations, messages), new SendConversationMessage(conversations, messages, input.generator, turnLock, input.contextMessages ?? 8, input.outputTokens ?? 160, consent), new StreamConversationMessage(conversations, messages, input.generator, turnLock, input.contextMessages ?? 8, input.outputTokens ?? 160, consent, new ConsoleConversationStreamObserver()));
    const router = Router();
    const auth = authenticationMiddleware(input.jwt);
    router.post('/', auth, requireFixedSyntheticBody, (req, res, next) => { void controller.create(req, res).catch(next); });
    router.get('/', auth, (req, res, next) => { void controller.list(req, res).catch(next); });
    router.get('/:id/messages', auth, (req, res, next) => { void controller.listConversationMessages(req, res).catch(next); });
    router.post('/:id/messages', auth, requireFixedSyntheticBody, (req, res, next) => { void controller.sendConversationMessage(req, res).catch(next); });
    router.post('/:id/messages/stream', auth, requireFixedSyntheticBody, (req, res, next) => { void controller.streamConversationMessage(req, res).catch(next); });
    router.get('/:id', auth, (req, res, next) => { void controller.get(req, res).catch(next); });
    return router;
}
