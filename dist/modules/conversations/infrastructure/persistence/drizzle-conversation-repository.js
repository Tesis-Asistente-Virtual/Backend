import { and, desc, eq } from 'drizzle-orm';
import { createConversation, conversationStatuses } from '../../domain/model/conversation.js';
import { conversations } from './schema.js';
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
    async listByOwner(accountId) {
        const rows = await this.db.select().from(conversations)
            .where(eq(conversations.accountId, accountId))
            .orderBy(desc(conversations.createdAt), desc(conversations.id));
        return rows.map(toDomain);
    }
}
