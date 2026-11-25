import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar, text, boolean } from 'drizzle-orm/pg-core';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { conversationalSignalAnalyses } from '../../../conversations/infrastructure/persistence/schema.js';

export const psychologicalReferrals = pgTable('psychological_referrals', {
  referralId: uuid('referral_id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  sourceAnalysisId: uuid('source_analysis_id').references(() => conversationalSignalAnalyses.analysisId, { onDelete: 'set null' }),
  sourceAnalysisAttached: boolean('source_analysis_attached').notNull().default(false),
  consentNoticeVersionId: uuid('consent_notice_version_id').notNull().references(() => consentNoticeVersions.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 24 }).notNull(),
  recipient: varchar('recipient', { length: 320 }).notNull(),
  reason: text('reason'),
  report: jsonb('report'),
  previewHash: varchar('preview_hash', { length: 64 }),
  createIdempotencyKey: uuid('create_idempotency_key').notNull(),
  sendIdempotencyKey: uuid('send_idempotency_key'),
  sendAttemptId: uuid('send_attempt_id'),
  deliveryReference: varchar('delivery_reference', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (table) => [
  check('psychological_referrals_status_check', sql`${table.status} in ('draft', 'sending', 'sent', 'failed', 'delivery_unknown', 'cancelled')`),
  check('psychological_referrals_reason_length_check', sql`${table.reason} is null or char_length(${table.reason}) <= 1200`),
  check('psychological_referrals_preview_shape_check', sql`(${table.status} = 'cancelled' and ${table.report} is null and ${table.previewHash} is null) or (${table.status} <> 'cancelled' and ${table.report} is not null and ${table.previewHash} ~ '^[0-9a-f]{64}$')`),
  check('psychological_referrals_source_shape_check', sql`${table.sourceAnalysisAttached} or ${table.sourceAnalysisId} is null`),
  check('psychological_referrals_send_state_check', sql`(${table.status} in ('draft', 'cancelled') and ${table.sendAttemptId} is null and ${table.sendIdempotencyKey} is null and ${table.sentAt} is null) or (${table.status} in ('sending', 'sent', 'failed', 'delivery_unknown') and ${table.sendAttemptId} is not null and ${table.sendIdempotencyKey} is not null and ((${table.status} = 'sent' and ${table.sentAt} is not null) or (${table.status} <> 'sent' and ${table.sentAt} is null)))`),
  uniqueIndex('psychological_referrals_account_create_idempotency_uq').on(table.accountId, table.createIdempotencyKey),
  uniqueIndex('psychological_referrals_account_send_idempotency_uq').on(table.accountId, table.sendIdempotencyKey).where(sql`${table.sendIdempotencyKey} is not null`),
  uniqueIndex('psychological_referrals_send_attempt_uq').on(table.sendAttemptId).where(sql`${table.sendAttemptId} is not null`),
  index('psychological_referrals_owner_created_idx').on(table.accountId, table.createdAt.desc()),
]);
