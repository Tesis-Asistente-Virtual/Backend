import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, timestamp, uuid, varchar, text, unique } from 'drizzle-orm/pg-core';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 150 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('conversations_status_check', sql`${table.status} in ('active', 'archived')`),
  unique('conversations_id_account_uq').on(table.id, table.accountId),
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

/** Minimal audit metadata only; message text and deleted conversation IDs are intentionally omitted. */
export const conversationSuppressionAudits = pgTable('conversation_suppression_audits', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  deletedConversationCount: integer('deleted_conversation_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('conversation_suppression_deleted_count_check', sql`${table.deletedConversationCount} > 0`),
  index('conversation_suppression_account_created_idx').on(table.accountId, table.createdAt),
]);

/** Persists exploratory output without duplicating source message text. */
export const conversationalSignalAnalyses = pgTable('conversational_signal_analyses', {
  analysisId: uuid('analysis_id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull(),
  consentNoticeVersionId: uuid('consent_notice_version_id').notNull().references(() => consentNoticeVersions.id, { onDelete: 'restrict' }),
  analysisVersion: varchar('analysis_version', { length: 40 }).notNull(),
  modelVersion: varchar('model_version', { length: 100 }).notNull(),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [
  foreignKey({ columns: [table.conversationId, table.accountId], foreignColumns: [conversations.id, conversations.accountId], name: 'conversational_signal_analyses_owner_fk' }).onDelete('cascade'),
  check('conversational_signal_analyses_period_check', sql`${table.periodStart} is null or ${table.periodEnd} is null or ${table.periodStart} <= ${table.periodEnd}`),
  check('conversational_signal_analyses_expiry_check', sql`${table.expiresAt} > ${table.analyzedAt}`),
  index('conversational_signal_analyses_owner_latest_idx').on(table.accountId, table.analyzedAt.desc()),
  index('conversational_signal_analyses_expiry_idx').on(table.expiresAt),
  unique('conversational_signal_analyses_id_account_uq').on(table.analysisId, table.accountId),
]);
