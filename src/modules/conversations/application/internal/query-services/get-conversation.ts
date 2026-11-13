import type { Conversation } from '../../../domain/model/conversation.js';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';

export class ConversationNotFound extends Error {
  constructor() { super('Conversation not found'); this.name = 'ConversationNotFound'; }
}

export class GetConversation {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(id: string, accountId: string): Promise<Conversation> {
    const conversation = await this.conversations.findByIdForOwner(id, accountId);
    if (!conversation) throw new ConversationNotFound();
    return conversation;
  }
}
