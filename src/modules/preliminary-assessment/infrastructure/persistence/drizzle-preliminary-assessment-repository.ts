import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { assessmentResponseSchema, type AssessmentResponse } from '../../domain/model/assessment-response.js';
import type { PreliminaryAssessmentResult } from '../../domain/model/assessment-result.js';
import { preliminaryAssessmentResultSchema } from '../../domain/model/assessment-result.js';
import { restorePreliminaryAssessment, type PreliminaryAssessment } from '../../domain/model/preliminary-assessment.js';
import type { PreliminaryAssessmentRepository } from '../../domain/repositories/preliminary-assessment-repository.js';
import { assessmentAnswers, assessmentResults, preliminaryAssessments } from './schema.js';
import { requireCurrentPreliminaryAssessmentConsent } from './preliminary-assessment-consent-transaction.js';

type AssessmentRow = typeof preliminaryAssessments.$inferSelect;
type AnswerRow = typeof assessmentAnswers.$inferSelect;

function toResponse(row: AnswerRow): AssessmentResponse {
  const parsed = assessmentResponseSchema.safeParse({
    assessmentId: row.assessmentId,
    instrumentVersionId: row.instrumentVersionId,
    questionId: row.questionId,
    status: row.status,
    answer: row.answer,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!parsed.success) throw new PreliminaryAssessmentError('invalid_response');
  return parsed.data;
}

function toAssessment(row: AssessmentRow, responses: readonly AssessmentResponse[]): PreliminaryAssessment {
  return restorePreliminaryAssessment({
    assessmentId: row.assessmentId,
    accountId: row.accountId,
    assessmentType: row.assessmentType,
    mode: row.mode,
    status: row.status,
    instrumentVersionId: row.instrumentVersionId,
    consentNoticeVersionId: row.consentNoticeVersionId,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    withdrawnAt: row.withdrawnAt,
    updatedAt: row.updatedAt,
    responses,
  });
}

function assessmentValues(assessment: PreliminaryAssessment) {
  return {
    assessmentId: assessment.assessmentId,
    accountId: assessment.accountId,
    assessmentType: assessment.assessmentType,
    mode: assessment.mode,
    status: assessment.status,
    instrumentVersionId: assessment.instrumentVersionId,
    consentNoticeVersionId: assessment.consentNoticeVersionId,
    createdAt: assessment.createdAt,
    startedAt: assessment.startedAt,
    completedAt: assessment.completedAt,
    withdrawnAt: assessment.withdrawnAt,
    updatedAt: assessment.updatedAt,
  };
}

export class DrizzlePreliminaryAssessmentRepository implements PreliminaryAssessmentRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(assessment: PreliminaryAssessment): Promise<void> {
    const valid = restorePreliminaryAssessment(assessment);
    if (valid.status !== 'in_progress' || valid.responses.length > 0) throw new PreliminaryAssessmentError('invalid_assessment');
    await this.db.transaction(async tx => {
      await requireCurrentPreliminaryAssessmentConsent(tx, valid.accountId, valid.consentNoticeVersionId, valid.startedAt);
      await tx.insert(preliminaryAssessments).values(assessmentValues(valid));
    });
  }

  async findByIdForOwner(assessmentId: string, accountId: string): Promise<PreliminaryAssessment | null> {
    const [row] = await this.db.select().from(preliminaryAssessments).where(and(
      eq(preliminaryAssessments.assessmentId, assessmentId), eq(preliminaryAssessments.accountId, accountId),
    )).limit(1);
    if (!row) return null;
    const rows = await this.db.select().from(assessmentAnswers)
      .where(eq(assessmentAnswers.assessmentId, row.assessmentId))
      .orderBy(asc(assessmentAnswers.createdAt), asc(assessmentAnswers.questionId));
    return toAssessment(row, rows.map(toResponse));
  }

  async listByOwner(accountId: string, limit: number, offset: number): Promise<readonly PreliminaryAssessment[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new PreliminaryAssessmentError('invalid_assessment');
    }
    const rows = await this.db.select().from(preliminaryAssessments)
      .where(eq(preliminaryAssessments.accountId, accountId))
      .orderBy(desc(preliminaryAssessments.createdAt), desc(preliminaryAssessments.assessmentId))
      .limit(limit).offset(offset);
    if (rows.length === 0) return [];
    const answers = await this.db.select().from(assessmentAnswers)
      .where(inArray(assessmentAnswers.assessmentId, rows.map(row => row.assessmentId)))
      .orderBy(asc(assessmentAnswers.createdAt), asc(assessmentAnswers.questionId));
    const byAssessment = new Map<string, AssessmentResponse[]>();
    for (const row of answers) {
      const list = byAssessment.get(row.assessmentId) ?? [];
      list.push(toResponse(row));
      byAssessment.set(row.assessmentId, list);
    }
    return rows.map(row => toAssessment(row, byAssessment.get(row.assessmentId) ?? []));
  }

  async saveForOwner(assessment: PreliminaryAssessment, accountId: string, expectedUpdatedAt: Date): Promise<boolean> {
    const valid = restorePreliminaryAssessment(assessment);
    if (valid.accountId !== accountId || valid.status === 'completed' || valid.updatedAt <= expectedUpdatedAt) return false;
    return this.db.transaction(async tx => {
      if (valid.status === 'in_progress') {
        await requireCurrentPreliminaryAssessmentConsent(tx, accountId, valid.consentNoticeVersionId, valid.updatedAt);
      }
      const [updated] = await tx.update(preliminaryAssessments).set(assessmentValues(valid)).where(and(
        eq(preliminaryAssessments.assessmentId, valid.assessmentId),
        eq(preliminaryAssessments.accountId, accountId),
        eq(preliminaryAssessments.updatedAt, expectedUpdatedAt),
      )).returning({ assessmentId: preliminaryAssessments.assessmentId });
      if (!updated) return false;
      if (valid.status === 'in_progress') {
        for (const response of valid.responses) {
          await tx.insert(assessmentAnswers).values({
            assessmentId: response.assessmentId,
            instrumentVersionId: response.instrumentVersionId,
            questionId: response.questionId,
            status: response.status,
            answer: response.answer,
            createdAt: response.createdAt,
            updatedAt: response.updatedAt,
          }).onConflictDoUpdate({
            target: [assessmentAnswers.assessmentId, assessmentAnswers.questionId],
            set: { status: response.status, answer: response.answer, updatedAt: response.updatedAt },
          });
        }
      }
      return true;
    });
  }

  async completeWithResultForOwner(
    assessment: PreliminaryAssessment,
    result: PreliminaryAssessmentResult,
    accountId: string,
    expectedUpdatedAt: Date,
  ): Promise<boolean> {
    const valid = restorePreliminaryAssessment(assessment);
    const validResult = preliminaryAssessmentResultSchema.safeParse(result);
    if (!validResult.success || valid.status !== 'completed' || valid.accountId !== accountId || valid.updatedAt <= expectedUpdatedAt ||
      validResult.data.assessmentId !== valid.assessmentId || validResult.data.instrumentVersionId !== valid.instrumentVersionId) {
      throw new PreliminaryAssessmentError('invalid_assessment');
    }
    return this.db.transaction(async tx => {
      await requireCurrentPreliminaryAssessmentConsent(tx, accountId, valid.consentNoticeVersionId, valid.updatedAt);
      const [updated] = await tx.update(preliminaryAssessments).set(assessmentValues(valid)).where(and(
        eq(preliminaryAssessments.assessmentId, valid.assessmentId),
        eq(preliminaryAssessments.accountId, accountId),
        eq(preliminaryAssessments.updatedAt, expectedUpdatedAt),
        eq(preliminaryAssessments.status, 'in_progress'),
      )).returning({ assessmentId: preliminaryAssessments.assessmentId });
      if (!updated) return false;
      const [insertedResult] = await tx.insert(assessmentResults).values({
        assessmentId: validResult.data.assessmentId,
        instrumentVersionId: validResult.data.instrumentVersionId,
        schemaVersion: validResult.data.schemaVersion,
        instrumentScores: validResult.data.instrumentScores,
        interpretation: validResult.data.interpretation,
        attentionPriority: validResult.data.attentionPriority,
        safetyState: validResult.data.safetyState,
        createdAt: validResult.data.calculatedAt,
      }).onConflictDoNothing({ target: assessmentResults.assessmentId }).returning({ id: assessmentResults.resultId });
      if (!insertedResult) throw new PreliminaryAssessmentError('result_conflict');
      return true;
    });
  }
}
