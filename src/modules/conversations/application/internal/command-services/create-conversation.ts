import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import type { Conversation } from '../../../domain/model/conversation.js';

export class CreateConversation {
  constructor(private readonly conversations: ConversationRepository) {}

  execute(accountId: string, title: string | null = null): Promise<Conversation> {
    return this.conversations.create({ accountId, title });
  }
}
