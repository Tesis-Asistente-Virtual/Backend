import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { isInstrumentAvailable, toPublicInstrumentQuestion } from '../../../domain/model/instrument.js';
/** Returns the exact pinned form and saved progress only to its owner while it remains open and authorized. */
export class GetMyAssessmentForm {
    assessments;
    instruments;
    consent;
    clock;
    constructor(assessments, instruments, consent, clock = () => new Date()) {
        this.assessments = assessments;
        this.instruments = instruments;
        this.consent = consent;
        this.clock = clock;
    }
    async execute(assessmentId, accountId) {
        const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (assessment.status !== 'in_progress' && assessment.status !== 'paused') {
            throw new PreliminaryAssessmentError('assessment_closed');
        }
        if (!assessment.instrumentVersionId)
            throw new PreliminaryAssessmentError('instrument_version_mismatch');
        await this.assertCurrentConsent(assessment.accountId, assessment.consentNoticeVersionId);
        const instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, this.clock());
        if (!instrument || instrument.instrumentVersionId !== assessment.instrumentVersionId || !isInstrumentAvailable(instrument)) {
            throw new PreliminaryAssessmentError('instrument_unavailable');
        }
        // Recheck after assembling the response; a withdrawal or notice replacement fails closed.
        await this.assertCurrentConsent(assessment.accountId, assessment.consentNoticeVersionId);
        return {
            assessment,
            instrument: {
                instrumentId: instrument.instrumentId,
                instrumentVersionId: instrument.instrumentVersionId,
                version: instrument.version,
                effectiveAt: instrument.effectiveAt,
                questions: [...instrument.questions]
                    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
                    .map(toPublicInstrumentQuestion),
            },
        };
    }
    async assertCurrentConsent(accountId, boundNoticeId) {
        let currentNoticeId;
        try {
            currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId);
        }
        catch {
            throw new PreliminaryAssessmentError('consent_required');
        }
        if (!currentNoticeId || currentNoticeId !== boundNoticeId)
            throw new PreliminaryAssessmentError('consent_required');
    }
}
