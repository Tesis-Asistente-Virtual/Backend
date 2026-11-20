import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { createConversationMessage, messageRoles, messageStatuses, orderConversationMessages, type ConversationMessage, type MessageRole, type MessageStatus, type NewConversationMessage } from '../../domain/model/conversation-message.js';
import type { Page, Pagination } from '../../domain/model/pagination.js';
import type { ConversationMessageRepository } from '../../domain/repositories/conversation-message-repository.js';
import { conversationMessages, conversations } from './schema.js';

function toDomain(row: typeof conversationMessages.$inferSelect): ConversationMessage {
  if (!messageRoles.includes(row.role as MessageRole)) throw new Error('Stored conversation message has an invalid role');
  if (!messageStatuses.includes(row.status as MessageStatus)) throw new Error('Stored conversation message has an invalid status');
  return createConversationMessage({ ...row, role: row.role as MessageRole, status: row.status as MessageStatus });
}

export class DrizzleConversationMessageRepository implements ConversationMessageRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async createForOwner(accountId: string, input: NewConversationMessage): Promise<ConversationMessage | null> {
    const [owner] = await this.db.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.accountId, accountId))).limit(1);
    if (!owner) return null;

    const [row] = await this.db.insert(conversationMessages).values(input).returning();
    return row ? toDomain(row) : null;
  }

  async findByIdsForOwner(conversationId: string, accountId: string, messageIds: readonly string[]): Promise<ConversationMessage[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.db.select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      role: conversationMessages.role,
      content: conversationMessages.content,
      status: conversationMessages.status,
      createdAt: conversationMessages.createdAt,
    }).from(conversationMessages)
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversations.accountId, accountId),
        eq(conversationMessages.status, 'completed'),
        inArray(conversationMessages.id, [...messageIds]),
      ))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
    return rows.map(toDomain);
  }

  async listByConversationForOwner(conversationId: string, accountId: string, pagination: Pagination): Promise<Page<ConversationMessage>> {
    const rows = await this.db.select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      role: conversationMessages.role,
      content: conversationMessages.content,
      status: conversationMessages.status,
      createdAt: conversationMessages.createdAt,
    }).from(conversationMessages)
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversations.accountId, accountId)))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    return { items: orderConversationMessages(rows.slice(0, pagination.limit).map(toDomain)), limit: pagination.limit, offset: pagination.offset, hasMore };
  }

  async listRecentCompletedForOwner(conversationId: string, accountId: string, limit: number): Promise<ConversationMessage[]> {
    const rows = await this.db.select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      role: conversationMessages.role,
      content: conversationMessages.content,
      status: conversationMessages.status,
      createdAt: conversationMessages.createdAt,
    }).from(conversationMessages)
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversations.accountId, accountId),
        eq(conversationMessages.status, 'completed'),
      ))
      .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
      .limit(limit);
    return orderConversationMessages(rows.map(toDomain));
  }
}
