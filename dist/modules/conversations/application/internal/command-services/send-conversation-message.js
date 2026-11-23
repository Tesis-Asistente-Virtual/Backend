import { ConversationNotFound } from '../query-services/get-conversation.js';
import { assistantInstructions } from '../../assistant-instructions.js';
import { buildConversationContext } from './build-conversation-context.js';
import { requireConversationProcessingConsent } from '../../ports/conversation-processing-consent.js';
export const MAX_USER_MESSAGE_CHARACTERS = 5_000;
export class ConversationArchived extends Error {
    constructor() { super('Conversation is archived'); this.name = 'ConversationArchived'; }
}
export class InvalidConversationMessage extends Error {
    constructor() { super('Conversation message is invalid'); this.name = 'InvalidConversationMessage'; }
}
export class AssistantGenerationUnavailable extends Error {
    constructor() { super('Assistant generation is temporarily unavailable'); this.name = 'AssistantGenerationUnavailable'; }
}
export class SendConversationMessage {
    conversations;
    messages;
    generator;
    turnLock;
    maxContextMessages;
    maxOutputTokens;
    consent;
    constructor(conversations, messages, generator, turnLock, maxContextMessages, maxOutputTokens, consent) {
        this.conversations = conversations;
        this.messages = messages;
        this.generator = generator;
        this.turnLock = turnLock;
        this.maxContextMessages = maxContextMessages;
        this.maxOutputTokens = maxOutputTokens;
        this.consent = consent;
    }
    async execute(accountId, conversationId, rawContent) {
        const content = rawContent.trim();
        if (!content || content.length > MAX_USER_MESSAGE_CHARACTERS)
            throw new InvalidConversationMessage();
        return this.turnLock.runExclusive(conversationId, async () => {
            const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
            if (!conversation)
                throw new ConversationNotFound();
            if (conversation.status !== 'active')
                throw new ConversationArchived();
            await requireConversationProcessingConsent(this.consent, accountId);
            const userMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, {
                conversationId,
                role: 'user',
                content,
                status: 'completed',
            });
            if (!userMessage)
                throw new ConversationNotFound();
            const context = await buildConversationContext(this.messages, conversationId, accountId, userMessage, this.maxContextMessages);
            // Revalidate immediately before disclosing the context to the provider.
            await requireConversationProcessingConsent(this.consent, accountId);
            let generatedText;
            try {
                const result = await this.generator.generateText({
                    instructions: assistantInstructions,
                    messages: context,
                    maxOutputTokens: this.maxOutputTokens,
                });
                generatedText = result.text.trim();
                if (!generatedText)
                    throw new Error('Provider returned empty text');
            }
            catch {
                try {
                    await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, {
                        conversationId, role: 'assistant', content: '', status: 'failed',
                    });
                }
                catch {
                    // A revocation or persistence failure must not be replaced by a secondary failure write.
                }
                throw new AssistantGenerationUnavailable();
            }
            const assistantMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, {
                conversationId,
                role: 'assistant',
                content: generatedText,
                status: 'completed',
            });
            if (!assistantMessage)
                throw new ConversationNotFound();
            return { userMessage, assistantMessage };
        });
    }
}
