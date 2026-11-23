import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, timestamp, unique, uniqueIndex, uuid, varchar, } from 'drizzle-orm/pg-core';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { conversations } from '../../../conversations/infrastructure/persistence/schema.js';
export const monitoringEnrollments = pgTable('monitoring_enrollments', {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(),
    consentPurpose: varchar('consent_purpose', { length: 40 }).notNull().default('longitudinal_monitoring'),
    // Opaque cross-context reference: authorization and notice validity are owned by Consent & Privacy.
    consentNoticeVersionId: uuid('consent_notice_version_id').notNull(),
    contractVersion: varchar('contract_version', { length: 20 }).notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull(),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    revision: integer('revision').notNull().default(1),
}, (table) => [
    check('monitoring_enrollments_status_ck', sql `${table.status} in ('active', 'paused', 'withdrawn', 'completed')`),
    check('monitoring_enrollments_purpose_ck', sql `${table.consentPurpose} = 'longitudinal_monitoring'`),
    check('monitoring_enrollments_contract_ck', sql `${table.contractVersion} = '1.0'`),
    check('monitoring_enrollments_revision_ck', sql `${table.revision} > 0`),
    check('monitoring_enrollments_time_ck', sql `${table.consentedAt} <= ${table.enrolledAt} and ${table.enrolledAt} <= ${table.updatedAt} and ${table.statusChangedAt} <= ${table.updatedAt}`),
    unique('monitoring_enrollments_id_account_uq').on(table.id, table.accountId),
    uniqueIndex('monitoring_enrollments_one_open_uq').on(table.accountId).where(sql `${table.status} in ('active', 'paused')`),
    index('monitoring_enrollments_owner_created_idx').on(table.accountId, table.enrolledAt.desc(), table.id.desc()),
]);
export const monitoringSessions = pgTable('monitoring_sessions', {
    id: uuid('id').defaultRandom().primaryKey(),
    enrollmentId: uuid('enrollment_id').notNull(),
    accountId: uuid('account_id').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    contractVersion: varchar('contract_version', { length: 20 }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
}, (table) => [
    foreignKey({
        name: 'monitoring_sessions_enrollment_owner_fk',
        columns: [table.enrollmentId, table.accountId],
        foreignColumns: [monitoringEnrollments.id, monitoringEnrollments.accountId],
    }).onDelete('cascade'),
    check('monitoring_sessions_status_ck', sql `${table.status} in ('in_progress', 'completed', 'abandoned')`),
    check('monitoring_sessions_contract_ck', sql `${table.contractVersion} = '1.0'`),
    check('monitoring_sessions_revision_ck', sql `${table.revision} > 0`),
    check('monitoring_sessions_time_ck', sql `${table.openedAt} <= ${table.updatedAt} and (${table.closedAt} is null or ${table.closedAt} >= ${table.openedAt})`),
    check('monitoring_sessions_closed_state_ck', sql `(${table.status} = 'in_progress' and ${table.closedAt} is null) or (${table.status} in ('completed', 'abandoned') and ${table.closedAt} is not null)`),
    uniqueIndex('monitoring_sessions_id_owner_uq').on(table.id, table.accountId),
    unique('monitoring_sessions_id_enrollment_owner_uq').on(table.id, table.enrollmentId, table.accountId),
    uniqueIndex('monitoring_sessions_one_open_uq').on(table.enrollmentId, table.accountId).where(sql `${table.status} = 'in_progress'`),
    index('monitoring_sessions_owner_enrollment_idx').on(table.accountId, table.enrollmentId, table.openedAt, table.id),
]);
/** Stores only the explicit relationship; conversation messages are never copied here. */
export const monitoringSessionConversations = pgTable('monitoring_session_conversations', {
    id: uuid('id').defaultRandom().primaryKey(),
    enrollmentId: uuid('enrollment_id').notNull(),
    monitoringSessionId: uuid('monitoring_session_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    accountId: uuid('account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    foreignKey({
        name: 'monitoring_session_conversations_session_owner_fk',
        columns: [table.monitoringSessionId, table.enrollmentId, table.accountId],
        foreignColumns: [monitoringSessions.id, monitoringSessions.enrollmentId, monitoringSessions.accountId],
    }).onDelete('cascade'),
    foreignKey({
        name: 'monitoring_session_conversations_conversation_owner_fk',
        columns: [table.conversationId, table.accountId],
        foreignColumns: [conversations.id, conversations.accountId],
    }).onDelete('cascade'),
    unique('monitoring_session_conversations_session_uq').on(table.monitoringSessionId),
    unique('monitoring_session_conversations_conversation_uq').on(table.conversationId),
    index('monitoring_session_conversations_owner_enrollment_idx').on(table.accountId, table.enrollmentId, table.createdAt),
]);
