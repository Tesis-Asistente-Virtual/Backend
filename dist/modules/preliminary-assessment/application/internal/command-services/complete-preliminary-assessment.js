import { completeAssessment } from '../../../domain/model/preliminary-assessment.js';
import { createUnavailableAssessmentResult } from '../../../domain/model/assessment-result.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { isInstrumentAvailable } from '../../../domain/model/instrument.js';
export class CompletePreliminaryAssessment {
    assessments;
    results;
    instruments;
    consent;
    clock;
    availability;
    constructor(assessments, results, instruments, consent, clock = () => new Date(), availability = instrument => isInstrumentAvailable(instrument)) {
        this.assessments = assessments;
        this.results = results;
        this.instruments = instruments;
        this.consent = consent;
        this.clock = clock;
        this.availability = availability;
    }
    async execute(assessmentId, accountId) {
        const current = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!current)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (current.status === 'completed') {
            const existingResult = await this.results.findByAssessmentForOwner(assessmentId, accountId);
            if (!existingResult)
                throw new PreliminaryAssessmentError('result_not_found');
            return { assessment: current, result: existingResult };
        }
        const noticeId = await this.consent.getCurrentNoticeVersionId(accountId);
        if (!noticeId || noticeId !== current.consentNoticeVersionId)
            throw new PreliminaryAssessmentError('consent_required');
        let instrument;
        if (current.instrumentVersionId) {
            instrument = await this.instruments.findAvailableByVersionId(current.instrumentVersionId, this.clock()) ?? undefined;
            if (!instrument)
                throw new PreliminaryAssessmentError('instrument_unavailable');
        }
        const at = new Date(Math.max(this.clock().getTime(), current.updatedAt.getTime() + 1));
        const completed = completeAssessment(current, at, instrument, this.availability);
        const result = createUnavailableAssessmentResult(completed.assessmentId, completed.instrumentVersionId, at);
        const saved = await this.assessments.completeWithResultForOwner(completed, result, accountId, current.updatedAt);
        if (!saved) {
            const latest = await this.assessments.findByIdForOwner(assessmentId, accountId);
            const existingResult = await this.results.findByAssessmentForOwner(assessmentId, accountId);
            if (latest?.status === 'completed' && existingResult)
                return { assessment: latest, result: existingResult };
            throw new PreliminaryAssessmentError('concurrent_modification');
        }
        return { assessment: completed, result };
    }
}
export { CompletePreliminaryAssessment as CompleteAssessment };
