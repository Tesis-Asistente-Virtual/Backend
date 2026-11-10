import { and, asc, eq } from 'drizzle-orm';
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
    async listByConversationForOwner(conversationId, accountId) {
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
            .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
        return orderConversationMessages(rows.map(toDomain));
    }
}
