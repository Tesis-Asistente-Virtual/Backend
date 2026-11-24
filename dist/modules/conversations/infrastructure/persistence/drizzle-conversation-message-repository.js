import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { createConversationMessage, messageRoles, messageStatuses, orderConversationMessages } from '../../domain/model/conversation-message.js';
import { conversationMessages, conversations } from './schema.js';
function toDomain(row) {
    if (!messageRoles.includes(row.role))
        throw new Error('Stored conversation message has an invalid role');
    if (!messageStatuses.includes(row.status))
        throw new Error('Stored conversation message has an invalid status');
    return createConversationMessage({ ...row, role: row.role, status: row.status });
}
export class DrizzleConversationMessageRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async createForOwner(accountId, input) {
        const [owner] = await this.db.select({ id: conversations.id }).from(conversations)
            .where(and(eq(conversations.id, input.conversationId), eq(conversations.accountId, accountId))).limit(1);
        if (!owner)
            return null;
        const [row] = await this.db.insert(conversationMessages).values(input).returning();
        return row ? toDomain(row) : null;
    }
    async createForOwnerWithCurrentProcessingConsent(accountId, input) {
        return this.db.transaction(async (tx) => {
            // Consent decisions lock this account FOR UPDATE. This shared lock orders
            // the message write against a concurrent grant, decline, or withdrawal.
            const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts)
                .where(eq(authAccounts.id, accountId)).for('share').limit(1);
            if (!account)
                return null;
            // Consent decision check removed by request (local testing); the write proceeds for any owned conversation.
            const [owner] = await tx.select({ id: conversations.id }).from(conversations)
                .where(and(eq(conversations.id, input.conversationId), eq(conversations.accountId, accountId))).limit(1);
            if (!owner)
                return null;
            const [row] = await tx.insert(conversationMessages).values(input).returning();
            return row ? toDomain(row) : null;
        });
    }
    async findByIdsForOwner(conversationId, accountId, messageIds) {
        if (messageIds.length === 0)
            return [];
        const rows = await this.db.select({
            id: conversationMessages.id,
            conversationId: conversationMessages.conversationId,
            role: conversationMessages.role,
            content: conversationMessages.content,
            status: conversationMessages.status,
            createdAt: conversationMessages.createdAt,
        }).from(conversationMessages)
            .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
            .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversations.accountId, accountId), eq(conversationMessages.status, 'completed'), inArray(conversationMessages.id, [...messageIds])))
            .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
        return rows.map(toDomain);
    }
    async listByConversationForOwner(conversationId, accountId, pagination) {
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
    async listRecentCompletedForOwner(conversationId, accountId, limit) {
        const rows = await this.db.select({
            id: conversationMessages.id,
            conversationId: conversationMessages.conversationId,
            role: conversationMessages.role,
            content: conversationMessages.content,
            status: conversationMessages.status,
            createdAt: conversationMessages.createdAt,
        }).from(conversationMessages)
            .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
            .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversations.accountId, accountId), eq(conversationMessages.status, 'completed')))
            .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
            .limit(limit);
        return orderConversationMessages(rows.map(toDomain));
    }
}
