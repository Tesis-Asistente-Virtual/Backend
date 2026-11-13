export class CreateConversation {
    conversations;
    constructor(conversations) {
        this.conversations = conversations;
    }
    execute(accountId, title = null) {
        return this.conversations.create({ accountId, title });
    }
}
