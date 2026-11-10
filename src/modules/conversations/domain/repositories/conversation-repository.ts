import type { Conversation, NewConversation } from '../model/conversation.js';

export interface ConversationRepository {
  create(input: NewConversation): Promise<Conversation>;
  findByIdForOwner(id: string, accountId: string): Promise<Conversation | null>;
  listByOwner(accountId: string): Promise<Conversation[]>;
}
