import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { conversationalSignalAnalyses } from '../../../conversations/infrastructure/persistence/schema.js';
export const wellbeingRecommendations = pgTable('wellbeing_recommendations', {
    recommendationSetId: uuid('recommendation_set_id').defaultRandom().primaryKey(),
    accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
    sourceAnalysisId: uuid('source_analysis_id').notNull(),
    consentNoticeVersionId: uuid('consent_notice_version_id').notNull().references(() => consentNoticeVersions.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 20 }).notNull(),
    generationToken: uuid('generation_token').notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    foreignKey({
        columns: [table.sourceAnalysisId, table.accountId],
        foreignColumns: [conversationalSignalAnalyses.analysisId, conversationalSignalAnalyses.accountId],
        name: 'wellbeing_recommendations_source_owner_fk',
    }).onDelete('cascade'),
    check('wellbeing_recommendations_status_check', sql `${table.status} in ('generating', 'available')`),
    check('wellbeing_recommendations_payload_state_check', sql `(${table.status} = 'generating' and ${table.payload} is null and ${table.generatedAt} is null) or (${table.status} = 'available' and ${table.payload} is not null and ${table.generatedAt} is not null)`),
    check('wellbeing_recommendations_expiry_check', sql `${table.expiresAt} > ${table.createdAt}`),
    unique('wellbeing_recommendations_source_analysis_uq').on(table.sourceAnalysisId),
    index('wellbeing_recommendations_owner_latest_idx').on(table.accountId, table.generatedAt.desc()),
    index('wellbeing_recommendations_expiry_idx').on(table.expiresAt),
]);
