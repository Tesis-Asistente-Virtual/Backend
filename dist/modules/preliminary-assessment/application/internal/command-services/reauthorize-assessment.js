import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { reauthorizeAssessment } from '../../../domain/model/preliminary-assessment.js';
/** Rebinds an open assessment to a newly granted, currently published notice. */
export class ReauthorizeAssessment {
    assessments;
    consent;
    clock;
    constructor(assessments, consent, clock = () => new Date()) {
        this.assessments = assessments;
        this.consent = consent;
        this.clock = clock;
    }
    async execute(assessmentId, accountId) {
        const current = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!current)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (current.status !== 'in_progress' && current.status !== 'paused') {
            throw new PreliminaryAssessmentError('assessment_closed');
        }
        const currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId);
        if (!currentNoticeId)
            throw new PreliminaryAssessmentError('consent_required');
        if (currentNoticeId === current.consentNoticeVersionId)
            return current;
        const at = new Date(Math.max(this.clock().getTime(), current.updatedAt.getTime() + 1));
        const updated = reauthorizeAssessment(current, currentNoticeId, at);
        const saved = await this.assessments.saveForOwner(updated, accountId, current.updatedAt);
        if (!saved)
            throw new PreliminaryAssessmentError('concurrent_modification');
        return updated;
    }
}
