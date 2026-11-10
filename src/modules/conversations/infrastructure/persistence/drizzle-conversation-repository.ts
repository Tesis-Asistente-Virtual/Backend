import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { createConversation, conversationStatuses, type Conversation, type ConversationStatus, type NewConversation } from '../../domain/model/conversation.js';
import type { ConversationRepository } from '../../domain/repositories/conversation-repository.js';
import { conversations } from './schema.js';

function toDomain(row: typeof conversations.$inferSelect): Conversation {
  if (!conversationStatuses.includes(row.status as ConversationStatus)) throw new Error('Stored conversation has an invalid status');
  return createConversation({ ...row, status: row.status as ConversationStatus });
}

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(input: NewConversation): Promise<Conversation> {
    const [row] = await this.db.insert(conversations).values(input).returning();
    if (!row) throw new Error('Conversation insert returned no row');
    return toDomain(row);
  }

  async findByIdForOwner(id: string, accountId: string): Promise<Conversation | null> {
    const [row] = await this.db.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.accountId, accountId))).limit(1);
    return row ? toDomain(row) : null;
  }

  async listByOwner(accountId: string): Promise<Conversation[]> {
    const rows = await this.db.select().from(conversations)
      .where(eq(conversations.accountId, accountId))
      .orderBy(desc(conversations.createdAt), desc(conversations.id));
    return rows.map(toDomain);
  }
}
