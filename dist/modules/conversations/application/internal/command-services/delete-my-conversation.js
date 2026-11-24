import { z } from 'zod';
import { ConversationNotFound } from '../query-services/get-conversation.js';
/** Explicit owner-initiated suppression of one conversation and its database-cascaded content. */
export class DeleteMyConversation {
    conversations;
    turnLock;
    constructor(conversations, turnLock) {
        this.conversations = conversations;
        this.turnLock = turnLock;
    }
    async execute(accountIdValue, conversationIdValue) {
        const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
        const conversationId = z.string().uuid().parse(conversationIdValue).toLowerCase();
        await this.turnLock.runExclusive(conversationId, async () => {
            const deleted = await this.conversations.deleteForOwner(accountId, conversationId);
            if (!deleted)
                throw new ConversationNotFound();
        });
    }
}
