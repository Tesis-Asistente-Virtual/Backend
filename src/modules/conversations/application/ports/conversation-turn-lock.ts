export class ConversationTurnInProgress extends Error {
  constructor() { super('A conversation turn is already in progress'); this.name = 'ConversationTurnInProgress'; }
}

export interface ConversationTurnLock {
  runExclusive<T>(conversationId: string, operation: () => Promise<T>): Promise<T>;
}
