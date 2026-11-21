import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { assessmentResponseSchema, validateResponseForInstrument } from '../../domain/model/assessment-response.js';
import { isInstrumentAvailable, parseInstrumentVersion } from '../../domain/model/instrument.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { assessmentAnswers, assessmentInstrumentQuestions, assessmentInstrumentVersions, preliminaryAssessments } from './schema.js';
function toDomain(row) {
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
export class DrizzleAssessmentResponseRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async saveForOwner(responseValue, accountId) {
        const parsed = assessmentResponseSchema.safeParse(responseValue);
        if (!parsed.success)
            throw new PreliminaryAssessmentError('invalid_response');
        const response = parsed.data;
        await this.db.transaction(async (tx) => {
            await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('share');
            const [assessment] = await tx.select().from(preliminaryAssessments).where(and(eq(preliminaryAssessments.assessmentId, response.assessmentId), eq(preliminaryAssessments.accountId, accountId))).for('update').limit(1);
            if (!assessment)
                throw new PreliminaryAssessmentError('assessment_not_found');
            if (assessment.status !== 'in_progress')
                throw new PreliminaryAssessmentError('assessment_closed');
            if (assessment.instrumentVersionId !== response.instrumentVersionId)
                throw new PreliminaryAssessmentError('instrument_version_mismatch');
            if (response.updatedAt < assessment.updatedAt)
                throw new PreliminaryAssessmentError('invalid_response');
            const [notice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(eq(consentNoticeVersions.id, assessment.consentNoticeVersionId), eq(consentNoticeVersions.purpose, 'preliminary_assessment'), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, response.updatedAt))).limit(1);
            const [latestConsent] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, 'preliminary_assessment'))).orderBy(desc(accountConsentEvents.sequence)).limit(1);
            if (!notice || latestConsent?.action !== 'granted' || latestConsent.noticeVersionId !== notice.id) {
                throw new PreliminaryAssessmentError('consent_required');
            }
            const [instrumentRow] = await tx.select().from(assessmentInstrumentVersions).where(eq(assessmentInstrumentVersions.instrumentVersionId, response.instrumentVersionId)).limit(1);
            if (!instrumentRow)
                throw new PreliminaryAssessmentError('instrument_unavailable');
            const questionRows = await tx.select().from(assessmentInstrumentQuestions).where(eq(assessmentInstrumentQuestions.instrumentVersionId, response.instrumentVersionId));
            const instrument = parseInstrumentVersion({
                instrumentId: instrumentRow.instrumentId,
                instrumentVersionId: instrumentRow.instrumentVersionId,
                version: instrumentRow.version,
                effectiveAt: instrumentRow.effectiveAt,
                status: instrumentRow.status,
                questions: questionRows.map(question => question.definition),
                approval: { status: instrumentRow.approvalStatus, approvedAt: instrumentRow.approvedAt, approvalReference: instrumentRow.approvalReference },
                license: { status: instrumentRow.licenseStatus, reference: instrumentRow.licenseReference },
            });
            if (!isInstrumentAvailable(instrument))
                throw new PreliminaryAssessmentError('instrument_unavailable');
            validateResponseForInstrument(response, instrument);
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
            await tx.update(preliminaryAssessments).set({ updatedAt: response.updatedAt })
                .where(eq(preliminaryAssessments.assessmentId, response.assessmentId));
        });
    }
    async listForAssessmentOwner(assessmentId, accountId) {
        const [owner] = await this.db.select({ id: preliminaryAssessments.assessmentId }).from(preliminaryAssessments)
            .where(and(eq(preliminaryAssessments.assessmentId, assessmentId), eq(preliminaryAssessments.accountId, accountId))).limit(1);
        if (!owner)
            return [];
        const rows = await this.db.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessmentId))
            .orderBy(asc(assessmentAnswers.createdAt), asc(assessmentAnswers.questionId));
        return rows.map(toDomain);
    }
}
