import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, timestamp, uniqueIndex, uuid, varchar, text } from 'drizzle-orm/pg-core';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';

export const consentNoticeVersions = pgTable('consent_notice_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  purpose: varchar('purpose', { length: 64 }).notNull(),
  version: varchar('version', { length: 40 }).notNull(),
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('consent_notice_purpose_check', sql`${table.purpose} in ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations', 'psychological_referral_sharing', 'longitudinal_monitoring', 'preliminary_assessment')`),
  check('consent_notice_status_check', sql`${table.status} in ('draft', 'published', 'superseded')`),
  check('consent_notice_hash_check', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex('consent_notice_purpose_version_uq').on(table.purpose, table.version),
  uniqueIndex('consent_notice_one_published_per_purpose_uq').on(table.purpose).where(sql`${table.status} = 'published'`),
]);

export const accountConsentEvents = pgTable('account_consent_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 64 }).notNull(),
  noticeVersionId: uuid('notice_version_id').notNull().references(() => consentNoticeVersions.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 20 }).notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('account_consent_purpose_check', sql`${table.purpose} in ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations', 'psychological_referral_sharing', 'longitudinal_monitoring', 'preliminary_assessment')`),
  check('account_consent_action_check', sql`${table.action} in ('granted', 'declined', 'withdrawn')`),
  uniqueIndex('account_consent_account_idempotency_uq').on(table.accountId, table.idempotencyKey),
  uniqueIndex('account_consent_sequence_uq').on(table.sequence),
  index('account_consent_status_idx').on(table.accountId, table.purpose, table.sequence.desc()),
]);
