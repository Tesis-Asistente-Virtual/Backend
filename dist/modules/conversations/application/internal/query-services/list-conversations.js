export class ListConversations {
    conversations;
    constructor(conversations) {
        this.conversations = conversations;
    }
    execute(accountId, pagination) {
        return this.conversations.listByOwner(accountId, pagination);
    }
}
