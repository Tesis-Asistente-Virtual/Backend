export class ConversationNotFound extends Error {
    constructor() { super('Conversation not found'); this.name = 'ConversationNotFound'; }
}
export class GetConversation {
    conversations;
    constructor(conversations) {
        this.conversations = conversations;
    }
    async execute(id, accountId) {
        const conversation = await this.conversations.findByIdForOwner(id, accountId);
        if (!conversation)
            throw new ConversationNotFound();
        return conversation;
    }
}
