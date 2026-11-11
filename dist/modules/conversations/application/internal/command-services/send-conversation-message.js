import { ConversationNotFound } from '../query-services/get-conversation.js';
import { assistantInstructions } from '../../assistant-instructions.js';
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
    constructor(conversations, messages, generator, turnLock, maxContextMessages, maxOutputTokens) {
        this.conversations = conversations;
        this.messages = messages;
        this.generator = generator;
        this.turnLock = turnLock;
        this.maxContextMessages = maxContextMessages;
        this.maxOutputTokens = maxOutputTokens;
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
            const userMessage = await this.messages.createForOwner(accountId, {
                conversationId,
                role: 'user',
                content,
                status: 'completed',
            });
            if (!userMessage)
                throw new ConversationNotFound();
            const recentMessages = await this.messages.listRecentCompletedForOwner(conversationId, accountId, this.maxContextMessages);
            const previousLimit = Math.max(0, this.maxContextMessages - 1);
            const completedPreviousMessages = recentMessages
                .filter(message => message.status === 'completed' && message.id !== userMessage.id);
            const previousContext = previousLimit > 0 ? completedPreviousMessages.slice(-previousLimit) : [];
            const context = [...previousContext, userMessage]
                .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
                .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
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
                const failedMessage = await this.messages.createForOwner(accountId, {
                    conversationId,
                    role: 'assistant',
                    content: '',
                    status: 'failed',
                });
                if (!failedMessage)
                    throw new ConversationNotFound();
                throw new AssistantGenerationUnavailable();
            }
            const assistantMessage = await this.messages.createForOwner(accountId, {
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
