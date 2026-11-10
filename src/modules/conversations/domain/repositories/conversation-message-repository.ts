import type { ConversationMessage, NewConversationMessage } from '../model/conversation-message.js';

export interface ConversationMessageRepository {
  createForOwner(accountId: string, input: NewConversationMessage): Promise<ConversationMessage | null>;
  listByConversationForOwner(conversationId: string, accountId: string): Promise<ConversationMessage[]>;
}
