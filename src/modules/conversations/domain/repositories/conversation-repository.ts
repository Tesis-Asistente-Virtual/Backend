import type { Conversation, NewConversation } from '../model/conversation.js';
import type { Page, Pagination } from '../model/pagination.js';

export interface ConversationRepository {
  create(input: NewConversation): Promise<Conversation>;
  findByIdForOwner(id: string, accountId: string): Promise<Conversation | null>;
  listByOwner(accountId: string, pagination: Pagination): Promise<Page<Conversation>>;
  deleteForOwner(accountId: string, conversationId: string): Promise<boolean>;
  /** Pasa a archivada cualquier conversación activa del titular. Devuelve cuántas cambió. */
  archiveActiveForOwner(accountId: string): Promise<number>;
}
