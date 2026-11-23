import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, primaryKey, smallint, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { AssessmentAnswer } from '../../domain/model/assessment-response.js';
import type { AssessmentMode, AssessmentStatus } from '../../domain/model/preliminary-assessment.js';
import type { InstrumentQuestion } from '../../domain/model/instrument.js';
import type { PreliminaryAssessmentResult } from '../../domain/model/assessment-result.js';
import type { Dass21AssessmentScore } from '../../domain/model/dass21-assessment-score.js';
import type { Dass21QuestionMapping } from '../../domain/model/dass21-question-mapping.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';

export const assessmentInstrumentVersions = pgTable('assessment_instrument_versions', {
  instrumentVersionId: uuid('instrument_version_id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id').notNull(),
  version: varchar('version', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).$type<'draft' | 'approved' | 'retired'>().notNull().default('draft'),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('pending'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvalReference: varchar('approval_reference', { length: 300 }),
  licenseStatus: varchar('license_status', { length: 20 }).notNull().default('not_reviewed'),
  licenseReference: varchar('license_reference', { length: 300 }),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('assessment_instrument_id_version_uq').on(table.instrumentId, table.version),
  uniqueIndex('assessment_instrument_version_id_instrument_id_uq').on(table.instrumentVersionId, table.instrumentId),
  index('assessment_instrument_available_idx').on(table.instrumentId, table.status, table.effectiveAt),
  check('assessment_instrument_status_check', sql`${table.status} in ('draft', 'approved', 'retired')`),
  check('assessment_instrument_approval_check', sql`${table.approvalStatus} in ('pending', 'approved', 'rejected')`),
  check('assessment_instrument_license_check', sql`${table.licenseStatus} in ('not_reviewed', 'authorized', 'restricted', 'not_applicable')`),
  check('assessment_instrument_publication_check', sql`${table.status} <> 'approved' OR (${table.approvalStatus} = 'approved' AND ${table.approvedAt} IS NOT NULL AND ${table.approvalReference} IS NOT NULL AND ${table.licenseStatus} IN ('authorized', 'not_applicable'))`),
]);

export const assessmentInstrumentQuestions = pgTable('assessment_instrument_questions', {
  instrumentVersionId: uuid('instrument_version_id').notNull().references(() => assessmentInstrumentVersions.instrumentVersionId, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull(),
  displayOrder: smallint('display_order'),
  definition: jsonb('definition').$type<InstrumentQuestion>().notNull(),
}, table => [
  primaryKey({ name: 'assessment_instrument_questions_pk', columns: [table.instrumentVersionId, table.questionId] }),
  index('assessment_instrument_questions_version_idx').on(table.instrumentVersionId),
  uniqueIndex('assessment_instrument_questions_order_uq').on(table.instrumentVersionId, table.displayOrder).where(sql`${table.displayOrder} IS NOT NULL`),
  check('assessment_instrument_question_display_order_check', sql`${table.displayOrder} IS NULL OR ${table.displayOrder} BETWEEN 1 AND 200`),
  check('assessment_instrument_question_definition_check', sql`jsonb_typeof(${table.definition}) = 'object' AND ${table.definition}->>'id' IS NOT NULL AND ${table.definition}->>'id' = ${table.questionId}::text`),
]);

export const assessmentScoringMappingVersions = pgTable('assessment_scoring_mapping_versions', {
  mappingId: uuid('mapping_id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id').notNull(),
  instrumentVersionId: uuid('instrument_version_id').notNull(),
  mappingVersion: varchar('mapping_version', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).$type<Dass21QuestionMapping['status']>().notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
}, table => [
  unique('assessment_scoring_mapping_version_uq').on(table.instrumentVersionId, table.mappingVersion),
  unique('assessment_scoring_mapping_identity_uq').on(table.mappingId, table.instrumentVersionId, table.instrumentId),
  foreignKey({ name: 'assessment_scoring_mapping_instrument_fk', columns: [table.instrumentVersionId, table.instrumentId], foreignColumns: [assessmentInstrumentVersions.instrumentVersionId, assessmentInstrumentVersions.instrumentId] }).onDelete('restrict'),
  check('assessment_scoring_mapping_status_check', sql`${table.status} in ('draft', 'frozen')`),
  check('assessment_scoring_mapping_frozen_check', sql`(${table.status} = 'frozen') = (${table.frozenAt} IS NOT NULL)`),
]);

export const assessmentScoringItemMappings = pgTable('assessment_scoring_item_mappings', {
  mappingId: uuid('mapping_id').notNull(),
  instrumentId: uuid('instrument_id').notNull(),
  instrumentVersionId: uuid('instrument_version_id').notNull(),
  questionId: uuid('question_id').notNull(),
  itemNumber: smallint('item_number').notNull(),
}, table => [
  primaryKey({ name: 'assessment_scoring_item_mapping_pk', columns: [table.mappingId, table.questionId] }),
  unique('assessment_scoring_item_mapping_item_uq').on(table.mappingId, table.itemNumber),
  foreignKey({ name: 'assessment_scoring_item_mapping_version_fk', columns: [table.mappingId, table.instrumentVersionId, table.instrumentId], foreignColumns: [assessmentScoringMappingVersions.mappingId, assessmentScoringMappingVersions.instrumentVersionId, assessmentScoringMappingVersions.instrumentId] }).onDelete('cascade'),
  foreignKey({ name: 'assessment_scoring_item_mapping_question_fk', columns: [table.instrumentVersionId, table.questionId], foreignColumns: [assessmentInstrumentQuestions.instrumentVersionId, assessmentInstrumentQuestions.questionId] }).onDelete('restrict'),
  check('assessment_scoring_item_mapping_number_check', sql`${table.itemNumber} between 1 and 21`),
]);

export const preliminaryAssessments = pgTable('preliminary_assessments', {
  assessmentId: uuid('assessment_id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  assessmentType: varchar('assessment_type', { length: 80 }).notNull(),
  mode: varchar('mode', { length: 40 }).$type<AssessmentMode>().notNull(),
  status: varchar('status', { length: 20 }).$type<AssessmentStatus>().notNull().default('in_progress'),
  instrumentVersionId: uuid('instrument_version_id').references(() => assessmentInstrumentVersions.instrumentVersionId, { onDelete: 'restrict' }),
  consentNoticeVersionId: uuid('consent_notice_version_id').notNull().references(() => consentNoticeVersions.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('preliminary_assessments_id_instrument_version_uq').on(table.assessmentId, table.instrumentVersionId),
  unique('preliminary_assessments_id_account_uq').on(table.assessmentId, table.accountId),
  index('preliminary_assessments_account_created_idx').on(table.accountId, table.createdAt.desc(), table.assessmentId),
  check('preliminary_assessment_status_check', sql`${table.status} in ('in_progress', 'paused', 'completed', 'withdrawn', 'expired')`),
  check('preliminary_assessment_mode_check', sql`${table.mode} in ('conversational_contextual', 'structured_instrument')`),
  check('preliminary_assessment_instrument_mode_check', sql`(${table.mode} = 'structured_instrument') = (${table.instrumentVersionId} IS NOT NULL)`),
  check('preliminary_assessment_completion_check', sql`(${table.status} = 'completed') = (${table.completedAt} IS NOT NULL)`),
  check('preliminary_assessment_withdrawal_check', sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} IS NOT NULL)`),
  check('preliminary_assessment_timestamps_check', sql`${table.createdAt} <= ${table.startedAt} AND ${table.startedAt} <= ${table.updatedAt} AND (${table.completedAt} IS NULL OR ${table.startedAt} <= ${table.completedAt}) AND (${table.withdrawnAt} IS NULL OR ${table.startedAt} <= ${table.withdrawnAt})`),
]);

export const assessmentAnswers = pgTable('assessment_answers', {
  answerId: uuid('answer_id').defaultRandom().primaryKey(),
  assessmentId: uuid('assessment_id').notNull().references(() => preliminaryAssessments.assessmentId, { onDelete: 'cascade' }),
  instrumentVersionId: uuid('instrument_version_id').notNull(),
  questionId: uuid('question_id').notNull(),
  status: varchar('status', { length: 20 }).$type<'pending' | 'answered'>().notNull(),
  answer: jsonb('answer').$type<AssessmentAnswer | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('assessment_answers_assessment_question_uq').on(table.assessmentId, table.questionId),
  index('assessment_answers_assessment_version_idx').on(table.assessmentId, table.instrumentVersionId),
  foreignKey({ name: 'assessment_answers_assessment_version_fk', columns: [table.assessmentId, table.instrumentVersionId], foreignColumns: [preliminaryAssessments.assessmentId, preliminaryAssessments.instrumentVersionId] }).onDelete('cascade'),
  foreignKey({ name: 'assessment_answers_question_version_fk', columns: [table.instrumentVersionId, table.questionId], foreignColumns: [assessmentInstrumentQuestions.instrumentVersionId, assessmentInstrumentQuestions.questionId] }),
  check('assessment_answer_status_check', sql`${table.status} in ('pending', 'answered')`),
  check('assessment_answer_payload_check', sql`(${table.status} = 'pending' AND ${table.answer} IS NULL) OR (${table.status} = 'answered' AND ${table.answer} IS NOT NULL AND jsonb_typeof(${table.answer}) = 'object')`),
  check('assessment_answer_timestamps_check', sql`${table.createdAt} <= ${table.updatedAt}`),
]);

export const assessmentResults = pgTable('assessment_results', {
  resultId: uuid('result_id').defaultRandom().primaryKey(),
  assessmentId: uuid('assessment_id').notNull().references(() => preliminaryAssessments.assessmentId, { onDelete: 'cascade' }),
  instrumentVersionId: uuid('instrument_version_id').references(() => assessmentInstrumentVersions.instrumentVersionId, { onDelete: 'restrict' }),
  schemaVersion: varchar('schema_version', { length: 20 }).notNull(),
  instrumentScores: jsonb('instrument_scores').$type<PreliminaryAssessmentResult['instrumentScores']>().notNull(),
  interpretation: jsonb('interpretation').$type<PreliminaryAssessmentResult['interpretation']>().notNull(),
  attentionPriority: jsonb('attention_priority').$type<PreliminaryAssessmentResult['attentionPriority']>().notNull(),
  safetyState: jsonb('safety_state').$type<PreliminaryAssessmentResult['safetyState']>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('assessment_results_assessment_uq').on(table.assessmentId),
  foreignKey({ name: 'assessment_results_version_match_fk', columns: [table.assessmentId, table.instrumentVersionId], foreignColumns: [preliminaryAssessments.assessmentId, preliminaryAssessments.instrumentVersionId] }),
  check('assessment_result_schema_version_check', sql`${table.schemaVersion} = '1.0'`),
  check('assessment_result_scores_unavailable_check', sql`jsonb_typeof(${table.instrumentScores}) = 'object' AND ${table.instrumentScores}->>'status' IS NOT NULL AND ${table.instrumentScores}->>'status' = 'not_available'`),
  check('assessment_result_interpretation_unavailable_check', sql`jsonb_typeof(${table.interpretation}) = 'object' AND ${table.interpretation}->>'status' IS NOT NULL AND ${table.interpretation}->>'status' = 'not_available'`),
  check('assessment_result_priority_unavailable_check', sql`jsonb_typeof(${table.attentionPriority}) = 'object' AND ${table.attentionPriority}->>'status' IS NOT NULL AND ${table.attentionPriority}->>'status' = 'not_available'`),
  check('assessment_result_safety_unassessed_check', sql`jsonb_typeof(${table.safetyState}) = 'object' AND ${table.safetyState}->>'status' IS NOT NULL AND ${table.safetyState}->>'status' = 'not_available' AND ${table.safetyState}->>'reason' IS NOT NULL AND ${table.safetyState}->>'reason' = 'not_assessed'`),
]);

/** Psychometric scores are stored separately and are deliberately excluded from public /result DTOs. */
export const assessmentPsychometricScores = pgTable('assessment_psychometric_scores', {
  scoreId: uuid('score_id').defaultRandom().primaryKey(),
  assessmentId: uuid('assessment_id').notNull(),
  accountId: uuid('account_id').notNull(),
  instrumentId: uuid('instrument_id').notNull(),
  instrumentVersionId: uuid('instrument_version_id').notNull(),
  mappingId: uuid('mapping_id').notNull(),
  mappingVersion: varchar('mapping_version', { length: 40 }).notNull(),
  scoringVersion: varchar('scoring_version', { length: 40 }).notNull(),
  schemaVersion: varchar('schema_version', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).$type<Dass21AssessmentScore['status']>().notNull(),
  depressionRawScore: smallint('depression_raw_score').notNull(),
  depressionEquivalentScore: smallint('depression_equivalent_score').notNull(),
  anxietyRawScore: smallint('anxiety_raw_score').notNull(),
  anxietyEquivalentScore: smallint('anxiety_equivalent_score').notNull(),
  stressRawScore: smallint('stress_raw_score').notNull(),
  stressEquivalentScore: smallint('stress_equivalent_score').notNull(),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull(),
}, table => [
  uniqueIndex('assessment_psychometric_scores_assessment_uq').on(table.assessmentId),
  foreignKey({ name: 'assessment_psychometric_scores_assessment_owner_fk', columns: [table.assessmentId, table.accountId], foreignColumns: [preliminaryAssessments.assessmentId, preliminaryAssessments.accountId] }).onDelete('cascade'),
  foreignKey({ name: 'assessment_psychometric_scores_assessment_version_fk', columns: [table.assessmentId, table.instrumentVersionId], foreignColumns: [preliminaryAssessments.assessmentId, preliminaryAssessments.instrumentVersionId] }).onDelete('cascade'),
  foreignKey({ name: 'assessment_psychometric_scores_instrument_fk', columns: [table.instrumentVersionId, table.instrumentId], foreignColumns: [assessmentInstrumentVersions.instrumentVersionId, assessmentInstrumentVersions.instrumentId] }).onDelete('restrict'),
  foreignKey({ name: 'assessment_psychometric_scores_mapping_fk', columns: [table.mappingId, table.instrumentVersionId, table.instrumentId], foreignColumns: [assessmentScoringMappingVersions.mappingId, assessmentScoringMappingVersions.instrumentVersionId, assessmentScoringMappingVersions.instrumentId] }).onDelete('restrict'),
  check('assessment_psychometric_scores_status_check', sql`${table.status} = 'calculated'`),
  check('assessment_psychometric_scores_schema_check', sql`${table.schemaVersion} = '1.0'`),
  check('assessment_psychometric_scores_mapping_version_check', sql`length(trim(${table.mappingVersion})) > 0 AND length(trim(${table.scoringVersion})) > 0`),
  check('assessment_psychometric_scores_depression_check', sql`${table.depressionRawScore} between 0 and 21 AND ${table.depressionEquivalentScore} = ${table.depressionRawScore} * 2`),
  check('assessment_psychometric_scores_anxiety_check', sql`${table.anxietyRawScore} between 0 and 21 AND ${table.anxietyEquivalentScore} = ${table.anxietyRawScore} * 2`),
  check('assessment_psychometric_scores_stress_check', sql`${table.stressRawScore} between 0 and 21 AND ${table.stressEquivalentScore} = ${table.stressRawScore} * 2`),
  index('assessment_psychometric_scores_owner_time_idx').on(table.accountId, table.calculatedAt.desc(), table.scoreId),
]);
