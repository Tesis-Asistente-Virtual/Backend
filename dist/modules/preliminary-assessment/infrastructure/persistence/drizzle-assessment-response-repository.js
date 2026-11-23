import { and, asc, eq } from 'drizzle-orm';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { assessmentResponseSchema, validateResponseForInstrument } from '../../domain/model/assessment-response.js';
import { isInstrumentAvailable, parseInstrumentVersion } from '../../domain/model/instrument.js';
import { assessmentAnswers, assessmentInstrumentQuestions, assessmentInstrumentVersions, preliminaryAssessments } from './schema.js';
import { requireCurrentPreliminaryAssessmentConsent } from './preliminary-assessment-consent-transaction.js';
import { enableTechnicalTestDraftForVersion } from './technical-test-draft-authorization.js';
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
    availability;
    technicalTestInstrumentVersionId;
    constructor(db, availability = instrument => isInstrumentAvailable(instrument), technicalTestInstrumentVersionId) {
        this.db = db;
        this.availability = availability;
        this.technicalTestInstrumentVersionId = technicalTestInstrumentVersionId;
    }
    async saveForOwner(responseValue, accountId) {
        const parsed = assessmentResponseSchema.safeParse(responseValue);
        if (!parsed.success)
            throw new PreliminaryAssessmentError('invalid_response');
        const response = parsed.data;
        await this.db.transaction(async (tx) => {
            await enableTechnicalTestDraftForVersion(tx, this.technicalTestInstrumentVersionId, response.instrumentVersionId);
            // Consent uses account -> notice lock ordering. Acquire both before the assessment row.
            const currentNoticeId = await requireCurrentPreliminaryAssessmentConsent(tx, accountId, undefined, response.updatedAt);
            const [assessment] = await tx.select().from(preliminaryAssessments).where(and(eq(preliminaryAssessments.assessmentId, response.assessmentId), eq(preliminaryAssessments.accountId, accountId))).for('update').limit(1);
            if (!assessment)
                throw new PreliminaryAssessmentError('assessment_not_found');
            if (assessment.status !== 'in_progress')
                throw new PreliminaryAssessmentError('assessment_closed');
            if (assessment.consentNoticeVersionId !== currentNoticeId)
                throw new PreliminaryAssessmentError('consent_required');
            if (assessment.instrumentVersionId !== response.instrumentVersionId)
                throw new PreliminaryAssessmentError('instrument_version_mismatch');
            if (response.updatedAt < assessment.updatedAt)
                throw new PreliminaryAssessmentError('invalid_response');
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
                questions: questionRows.map(question => ({
                    ...(typeof question.definition === 'object' && question.definition !== null ? question.definition : {}),
                    ...(question.displayOrder === null ? {} : { displayOrder: question.displayOrder }),
                })),
                approval: { status: instrumentRow.approvalStatus, approvedAt: instrumentRow.approvedAt, approvalReference: instrumentRow.approvalReference },
                license: { status: instrumentRow.licenseStatus, reference: instrumentRow.licenseReference },
            });
            if (!this.availability(instrument, response.updatedAt))
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
