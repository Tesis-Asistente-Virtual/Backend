export class ConversationTurnInProgress extends Error {
    constructor() { super('A conversation turn is already in progress'); this.name = 'ConversationTurnInProgress'; }
}
