/** Uses only the dedicated AI conversation processing purpose. */
export class ConsentConversationProcessingAuthorizer {
    checker;
    constructor(checker) {
        this.checker = checker;
    }
    isAuthorized(accountId) {
        return this.checker.execute(accountId, 'ai_conversation_processing');
    }
}
