import { ConversationNotFound } from './get-conversation.js';
export class ListConversationMessages {
    conversations;
    messages;
    constructor(conversations, messages) {
        this.conversations = conversations;
        this.messages = messages;
    }
    async execute(conversationId, accountId, pagination) {
        const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
        if (!conversation)
            throw new ConversationNotFound();
        return this.messages.listByConversationForOwner(conversationId, accountId, pagination);
    }
}
