import type { Conversation } from '../../../domain/model/conversation.js';
import type { ConversationMessage } from '../../../domain/model/conversation-message.js';

export function toConversationResource(value: Conversation) {
  return {
    id: value.id,
    title: value.title,
    status: value.status,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

export function toConversationMessageResource(value: ConversationMessage) {
  return {
    id: value.id,
    conversationId: value.conversationId,
    role: value.role,
    content: value.content,
    status: value.status,
    createdAt: value.createdAt.toISOString(),
  };
}

export function toPageResource<T, R>(page: { items: T[]; limit: number; offset: number; hasMore: boolean }, transform: (item: T) => R) {
  return {
    items: page.items.map(transform),
    pagination: { limit: page.limit, offset: page.offset, hasMore: page.hasMore },
  };
}
