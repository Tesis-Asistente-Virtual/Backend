import type { Conversation } from '../../../domain/model/conversation.js';
import type { Page, Pagination } from '../../../domain/model/pagination.js';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';

export class ListConversations {
  constructor(private readonly conversations: ConversationRepository) {}

  execute(accountId: string, pagination: Pagination): Promise<Page<Conversation>> {
    return this.conversations.listByOwner(accountId, pagination);
  }
}
