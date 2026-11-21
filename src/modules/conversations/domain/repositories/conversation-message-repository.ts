import type { ConversationMessage, NewConversationMessage } from '../model/conversation-message.js';
import type { Page, Pagination } from '../model/pagination.js';

export interface ConversationMessageRepository {
  createForOwner(accountId: string, input: NewConversationMessage): Promise<ConversationMessage | null>;
  createForOwnerWithCurrentProcessingConsent(accountId: string, input: NewConversationMessage): Promise<ConversationMessage | null>;
  findByIdsForOwner(conversationId: string, accountId: string, messageIds: readonly string[]): Promise<ConversationMessage[]>;
  listByConversationForOwner(conversationId: string, accountId: string, pagination: Pagination): Promise<Page<ConversationMessage>>;
  listRecentCompletedForOwner(conversationId: string, accountId: string, limit: number): Promise<ConversationMessage[]>;
}
