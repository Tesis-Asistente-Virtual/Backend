import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uuid, varchar, text } from 'drizzle-orm/pg-core';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 150 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('conversations_status_check', sql`${table.status} in ('active', 'archived')`),
  index('conversations_account_created_idx').on(table.accountId, table.createdAt.desc()),
]);

export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('conversation_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
  check('conversation_messages_status_check', sql`${table.status} in ('generating', 'completed', 'failed')`),
  index('conversation_messages_conversation_created_id_idx').on(table.conversationId, table.createdAt, table.id),
]);
