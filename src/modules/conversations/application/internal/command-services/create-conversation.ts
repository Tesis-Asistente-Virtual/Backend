import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import type { Conversation } from '../../../domain/model/conversation.js';

export class CreateConversation {
  constructor(private readonly conversations: ConversationRepository) {}

  /** Solo puede haber una conversación activa por titular: la anterior se archiva y queda en el historial. */
  async execute(accountId: string, title: string | null = null): Promise<Conversation> {
    await this.conversations.archiveActiveForOwner(accountId);
    return this.conversations.create({ accountId, title });
  }
}
