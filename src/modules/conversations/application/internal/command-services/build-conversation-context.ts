import type { AiTextContextMessage } from '../../ports/ai-text-generator.js';
import type { ConversationMessage } from '../../../domain/model/conversation-message.js';
import type { ConversationMessageRepository } from '../../../domain/repositories/conversation-message-repository.js';

export async function buildConversationContext(
  repository: ConversationMessageRepository,
  conversationId: string,
  accountId: string,
  currentUserMessage: ConversationMessage,
  maxContextMessages: number,
): Promise<AiTextContextMessage[]> {
  const recent = await repository.listRecentCompletedForOwner(conversationId, accountId, maxContextMessages);
  const previousLimit = Math.max(0, maxContextMessages - 1);
  const previous = recent.filter(message => message.status === 'completed' && message.id !== currentUserMessage.id);
  const priorContext = previousLimit > 0 ? previous.slice(-previousLimit) : [];
  return [...priorContext, currentUserMessage]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
    .map(({ role, content }) => ({ role, content }));
}
