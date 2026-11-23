import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
export class GetMyAssessment {
    assessments;
    consent;
    constructor(assessments, consent) {
        this.assessments = assessments;
        this.consent = consent;
    }
    async execute(assessmentId, accountId) {
        const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (assessment.status === 'in_progress' || assessment.status === 'paused') {
            if (!this.consent)
                throw new PreliminaryAssessmentError('consent_required');
            let currentNoticeId;
            try {
                currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId);
            }
            catch {
                throw new PreliminaryAssessmentError('consent_required');
            }
            if (!currentNoticeId || currentNoticeId !== assessment.consentNoticeVersionId)
                throw new PreliminaryAssessmentError('consent_required');
        }
        return assessment;
    }
}
