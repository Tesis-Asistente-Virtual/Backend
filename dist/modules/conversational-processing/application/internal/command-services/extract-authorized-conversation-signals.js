import { z } from 'zod';
import { ConversationSignalExtractionError, parseConversationSignalExtraction, } from '../../ports/conversation-signal-extractor.js';
const requestSchema = z.object({
    conversationId: z.string().uuid().transform(value => value.toLowerCase()),
    messageIds: z.array(z.string().uuid().transform(value => value.toLowerCase())).min(1).max(20).refine(values => new Set(values).size === values.length, 'Message references must be unique'),
}).strict();
export class SignalConversationNotFound extends Error {
    constructor() { super('Conversation is unavailable'); this.name = 'SignalConversationNotFound'; }
}
export class SignalConsentRequired extends Error {
    constructor() { super('Required consent is not granted'); this.name = 'SignalConsentRequired'; }
}
export class SignalAuthorizationUnavailable extends Error {
    constructor() { super('Signal extraction authorization is unavailable'); this.name = 'SignalAuthorizationUnavailable'; }
}
export class SignalExtractionUnavailable extends Error {
    constructor() { super('Signal extraction is not configured'); this.name = 'SignalExtractionUnavailable'; }
}
export class SignalMessageReferencesInvalid extends Error {
    constructor() { super('Conversation message references are invalid'); this.name = 'SignalMessageReferencesInvalid'; }
}
function chronologically(messages) {
    return [...messages].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
}
/** Internal orchestration; callers must pass the account identity from a verified auth context. */
export class ExtractAuthorizedConversationSignals {
    conversations;
    messages;
    consent;
    extractor;
    constructor(conversations, messages, consent, extractor) {
        this.conversations = conversations;
        this.messages = messages;
        this.consent = consent;
        this.extractor = extractor;
    }
    async execute(accountIdValue, inputValue, signal) {
        const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
        const input = requestSchema.parse(inputValue);
        if (signal?.aborted)
            throw new ConversationSignalExtractionError('cancelled');
        const conversation = await this.conversations.findByIdForOwner(input.conversationId, accountId);
        if (!conversation || conversation.accountId !== accountId)
            throw new SignalConversationNotFound();
        await this.assertRequiredConsents(accountId);
        const ownedMessages = await this.messages.findByIdsForOwner(input.conversationId, accountId, input.messageIds);
        if (ownedMessages.length !== input.messageIds.length || ownedMessages.some(message => message.conversationId !== conversation.id || message.status !== 'completed'))
            throw new SignalMessageReferencesInvalid();
        const orderedMessages = chronologically(ownedMessages);
        const requestedIds = new Set(input.messageIds);
        if (orderedMessages.some(message => !requestedIds.has(message.id)))
            throw new SignalMessageReferencesInvalid();
        const extractionInput = {
            messages: orderedMessages.map(({ id: messageId, role, content }) => ({ messageId, role, content })),
        };
        // Re-check immediately before sending content to the provider to narrow the revocation race.
        await this.assertRequiredConsents(accountId);
        if (signal?.aborted)
            throw new ConversationSignalExtractionError('cancelled');
        const result = await this.extractor.extract(extractionInput, signal);
        const validated = parseConversationSignalExtraction(result);
        const suppliedIds = new Set(extractionInput.messages.map(message => message.messageId));
        if (validated.observations.some(observation => observation.sourceMessageIds.some(id => !suppliedIds.has(id)))) {
            throw new ConversationSignalExtractionError('invalid_response');
        }
        return validated;
    }
    // Consent checks removed by request (local testing): extraction is not blocked by consent decisions.
    async assertRequiredConsents(_accountId) {
        return;
    }
}
