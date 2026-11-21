import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { assessmentResponseSchema } from '../../domain/model/assessment-response.js';
import { preliminaryAssessmentResultSchema } from '../../domain/model/assessment-result.js';
import { restorePreliminaryAssessment } from '../../domain/model/preliminary-assessment.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { assessmentAnswers, assessmentResults, preliminaryAssessments } from './schema.js';
function toResponse(row) {
    const parsed = assessmentResponseSchema.safeParse({
        assessmentId: row.assessmentId,
        instrumentVersionId: row.instrumentVersionId,
        questionId: row.questionId,
        status: row.status,
        answer: row.answer,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    });
    if (!parsed.success)
        throw new PreliminaryAssessmentError('invalid_response');
    return parsed.data;
}
function toAssessment(row, responses) {
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
function assessmentValues(assessment) {
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
export class DrizzlePreliminaryAssessmentRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(assessment) {
        const valid = restorePreliminaryAssessment(assessment);
        if (valid.status !== 'in_progress' || valid.responses.length > 0)
            throw new PreliminaryAssessmentError('invalid_assessment');
        await this.db.transaction(async (tx) => {
            await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, valid.accountId)).for('share');
            const [notice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(eq(consentNoticeVersions.id, valid.consentNoticeVersionId), eq(consentNoticeVersions.purpose, 'preliminary_assessment'), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, valid.startedAt))).limit(1);
            const [latestConsent] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, valid.accountId), eq(accountConsentEvents.purpose, 'preliminary_assessment'))).orderBy(desc(accountConsentEvents.sequence)).limit(1);
            if (!notice || latestConsent?.action !== 'granted' || latestConsent.noticeVersionId !== notice.id) {
                throw new PreliminaryAssessmentError('consent_required');
            }
            await tx.insert(preliminaryAssessments).values(assessmentValues(valid));
        });
    }
    async findByIdForOwner(assessmentId, accountId) {
        const [row] = await this.db.select().from(preliminaryAssessments).where(and(eq(preliminaryAssessments.assessmentId, assessmentId), eq(preliminaryAssessments.accountId, accountId))).limit(1);
        if (!row)
            return null;
        const rows = await this.db.select().from(assessmentAnswers)
            .where(eq(assessmentAnswers.assessmentId, row.assessmentId))
            .orderBy(asc(assessmentAnswers.createdAt), asc(assessmentAnswers.questionId));
        return toAssessment(row, rows.map(toResponse));
    }
    async listByOwner(accountId, limit, offset) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
            throw new PreliminaryAssessmentError('invalid_assessment');
        }
        const rows = await this.db.select().from(preliminaryAssessments)
            .where(eq(preliminaryAssessments.accountId, accountId))
            .orderBy(desc(preliminaryAssessments.createdAt), desc(preliminaryAssessments.assessmentId))
            .limit(limit).offset(offset);
        if (rows.length === 0)
            return [];
        const answers = await this.db.select().from(assessmentAnswers)
            .where(inArray(assessmentAnswers.assessmentId, rows.map(row => row.assessmentId)))
            .orderBy(asc(assessmentAnswers.createdAt), asc(assessmentAnswers.questionId));
        const byAssessment = new Map();
        for (const row of answers) {
            const list = byAssessment.get(row.assessmentId) ?? [];
            list.push(toResponse(row));
            byAssessment.set(row.assessmentId, list);
        }
        return rows.map(row => toAssessment(row, byAssessment.get(row.assessmentId) ?? []));
    }
    async saveForOwner(assessment, accountId, expectedUpdatedAt) {
        const valid = restorePreliminaryAssessment(assessment);
        if (valid.accountId !== accountId || valid.status === 'completed' || valid.updatedAt <= expectedUpdatedAt)
            return false;
        return this.db.transaction(async (tx) => {
            if (valid.status === 'in_progress' || valid.status === 'completed') {
                await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('share');
                const [latestConsent] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, 'preliminary_assessment'))).orderBy(desc(accountConsentEvents.sequence)).limit(1);
                if (latestConsent?.action !== 'granted' || latestConsent.noticeVersionId !== valid.consentNoticeVersionId) {
                    throw new PreliminaryAssessmentError('consent_required');
                }
            }
            const [updated] = await tx.update(preliminaryAssessments).set(assessmentValues(valid)).where(and(eq(preliminaryAssessments.assessmentId, valid.assessmentId), eq(preliminaryAssessments.accountId, accountId), eq(preliminaryAssessments.updatedAt, expectedUpdatedAt))).returning({ assessmentId: preliminaryAssessments.assessmentId });
            if (!updated)
                return false;
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
    async completeWithResultForOwner(assessment, result, accountId, expectedUpdatedAt) {
        const valid = restorePreliminaryAssessment(assessment);
        const validResult = preliminaryAssessmentResultSchema.safeParse(result);
        if (!validResult.success || valid.status !== 'completed' || valid.accountId !== accountId || valid.updatedAt <= expectedUpdatedAt ||
            validResult.data.assessmentId !== valid.assessmentId || validResult.data.instrumentVersionId !== valid.instrumentVersionId) {
            throw new PreliminaryAssessmentError('invalid_assessment');
        }
        return this.db.transaction(async (tx) => {
            await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('share');
            const [latestConsent] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, 'preliminary_assessment'))).orderBy(desc(accountConsentEvents.sequence)).limit(1);
            if (latestConsent?.action !== 'granted' || latestConsent.noticeVersionId !== valid.consentNoticeVersionId) {
                throw new PreliminaryAssessmentError('consent_required');
            }
            const [updated] = await tx.update(preliminaryAssessments).set(assessmentValues(valid)).where(and(eq(preliminaryAssessments.assessmentId, valid.assessmentId), eq(preliminaryAssessments.accountId, accountId), eq(preliminaryAssessments.updatedAt, expectedUpdatedAt), eq(preliminaryAssessments.status, 'in_progress'))).returning({ assessmentId: preliminaryAssessments.assessmentId });
            if (!updated)
                return false;
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
            if (!insertedResult)
                throw new PreliminaryAssessmentError('result_conflict');
            return true;
        });
    }
}
