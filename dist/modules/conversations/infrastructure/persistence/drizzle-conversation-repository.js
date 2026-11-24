import { and, desc, eq } from 'drizzle-orm';
import { createConversation, conversationStatuses } from '../../domain/model/conversation.js';
import { conversationSuppressionAudits, conversations } from './schema.js';
function toDomain(row) {
    if (!conversationStatuses.includes(row.status))
        throw new Error('Stored conversation has an invalid status');
    return createConversation({ ...row, status: row.status });
}
export class DrizzleConversationRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(input) {
        const [row] = await this.db.insert(conversations).values(input).returning();
        if (!row)
            throw new Error('Conversation insert returned no row');
        return toDomain(row);
    }
    async findByIdForOwner(id, accountId) {
        const [row] = await this.db.select().from(conversations)
            .where(and(eq(conversations.id, id), eq(conversations.accountId, accountId))).limit(1);
        return row ? toDomain(row) : null;
    }
    async listByOwner(accountId, pagination) {
        const rows = await this.db.select().from(conversations)
            .where(eq(conversations.accountId, accountId))
            .orderBy(desc(conversations.createdAt), desc(conversations.id))
            .limit(pagination.limit + 1)
            .offset(pagination.offset);
        const hasMore = rows.length > pagination.limit;
        return { items: rows.slice(0, pagination.limit).map(toDomain), limit: pagination.limit, offset: pagination.offset, hasMore };
    }
    async deleteForOwner(accountId, conversationId) {
        return this.db.transaction(async (tx) => {
            const deleted = await tx.delete(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.accountId, accountId))).returning({ id: conversations.id });
            if (deleted.length === 0)
                return false;
            await tx.insert(conversationSuppressionAudits).values({ accountId, deletedConversationCount: 1 });
            return true;
        });
    }
}
