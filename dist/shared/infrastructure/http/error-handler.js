import { ZodError } from 'zod';
import { EmailAlreadyRegistered } from '../../../modules/authentication/application/internal/command-services/sign-up.js';
import { InvalidCredentials } from '../../../modules/authentication/application/internal/command-services/sign-in.js';
import { InvalidRefreshToken } from '../../../modules/authentication/application/internal/command-services/refresh-session.js';
import { ProfileNotFound } from '../../../modules/users/application/internal/query-services/get-my-profile.js';
import { ConversationNotFound } from '../../../modules/conversations/application/internal/query-services/get-conversation.js';
import { AssistantGenerationUnavailable, ConversationArchived, InvalidConversationMessage } from '../../../modules/conversations/application/internal/command-services/send-conversation-message.js';
import { ConversationTurnInProgress } from '../../../modules/conversations/application/ports/conversation-turn-lock.js';
function hasUniqueViolationCode(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
export const errorHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
        res.status(400).json({ error: 'Invalid request data' });
        return;
    }
    if (err instanceof EmailAlreadyRegistered || hasUniqueViolationCode(err)) {
        res.status(409).json({ error: 'Email is already registered' });
        return;
    }
    if (err instanceof InvalidCredentials || err instanceof InvalidRefreshToken) {
        res.status(401).json({ error: err instanceof InvalidCredentials ? 'Invalid email or password' : 'Invalid refresh token' });
        return;
    }
    if (err instanceof ProfileNotFound) {
        res.status(404).json({ error: 'Profile not found' });
        return;
    }
    if (err instanceof ConversationNotFound) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
    }
    if (err instanceof ConversationArchived || err instanceof ConversationTurnInProgress) {
        res.status(409).json({ error: err instanceof ConversationArchived ? 'Conversation is archived' : 'Conversation turn already in progress' });
        return;
    }
    if (err instanceof InvalidConversationMessage) {
        res.status(400).json({ error: 'Invalid conversation message' });
        return;
    }
    if (err instanceof AssistantGenerationUnavailable) {
        res.status(503).json({ error: 'Text generation is temporarily unavailable' });
        return;
    }
    console.error('Unhandled request error');
    res.status(500).json({ error: 'Internal server error' });
};
