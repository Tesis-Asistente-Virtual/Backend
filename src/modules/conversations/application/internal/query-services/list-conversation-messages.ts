import type { ConversationMessage } from '../../../domain/model/conversation-message.js';
import type { Page, Pagination } from '../../../domain/model/pagination.js';
import type { ConversationMessageRepository } from '../../../domain/repositories/conversation-message-repository.js';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import { ConversationNotFound } from './get-conversation.js';

export class ListConversationMessages {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: ConversationMessageRepository,
  ) {}

  async execute(conversationId: string, accountId: string, pagination: Pagination): Promise<Page<ConversationMessage>> {
    const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
    if (!conversation) throw new ConversationNotFound();
    return this.messages.listByConversationForOwner(conversationId, accountId, pagination);
  }
}
