import { pauseAssessment, resumeAssessment, withdrawAssessment } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
export class ChangeAssessmentState {
    assessments;
    consent;
    clock;
    constructor(assessments, consent, clock = () => new Date()) {
        this.assessments = assessments;
        this.consent = consent;
        this.clock = clock;
    }
    async execute(assessmentId, accountId, action) {
        const current = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!current)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (action === 'resume') {
            const noticeId = await this.consent.getCurrentNoticeVersionId(accountId);
            if (!noticeId || noticeId !== current.consentNoticeVersionId)
                throw new PreliminaryAssessmentError('consent_required');
        }
        const at = new Date(Math.max(this.clock().getTime(), current.updatedAt.getTime() + 1));
        const next = action === 'pause' ? pauseAssessment(current, at)
            : action === 'resume' ? resumeAssessment(current, at)
                : withdrawAssessment(current, at);
        const saved = await this.assessments.saveForOwner(next, accountId, current.updatedAt);
        if (!saved)
            throw new PreliminaryAssessmentError('concurrent_modification');
        return next;
    }
}
export class PauseAssessment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(assessmentId, accountId) { return this.state.execute(assessmentId, accountId, 'pause'); }
}
export class ResumeAssessment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(assessmentId, accountId) { return this.state.execute(assessmentId, accountId, 'resume'); }
}
export class WithdrawAssessment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(assessmentId, accountId) { return this.state.execute(assessmentId, accountId, 'withdraw'); }
}
