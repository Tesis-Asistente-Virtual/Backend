import { recordAssessmentResponse } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
export class SubmitAssessmentResponse {
    assessments;
    responses;
    instruments;
    consent;
    clock;
    constructor(assessments, responses, instruments, consent, clock = () => new Date()) {
        this.assessments = assessments;
        this.responses = responses;
        this.instruments = instruments;
        this.consent = consent;
        this.clock = clock;
    }
    async execute(assessmentId, accountId, questionId, answer) {
        const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (assessment.status !== 'in_progress' || !assessment.instrumentVersionId)
            throw new PreliminaryAssessmentError('assessment_closed');
        const currentNotice = await this.consent.getCurrentNoticeVersionId(accountId);
        if (!currentNotice || currentNotice !== assessment.consentNoticeVersionId)
            throw new PreliminaryAssessmentError('consent_required');
        const instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, this.clock());
        if (!instrument)
            throw new PreliminaryAssessmentError('instrument_unavailable');
        const previous = assessment.responses.find(response => response.questionId === questionId);
        const now = this.clock();
        const updatedAt = new Date(Math.max(now.getTime(), assessment.updatedAt.getTime() + 1));
        const response = {
            assessmentId, instrumentVersionId: instrument.instrumentVersionId, questionId,
            status: answer === null ? 'pending' : 'answered', answer,
            createdAt: previous?.createdAt ?? updatedAt,
            updatedAt,
        };
        const updated = recordAssessmentResponse(assessment, response, instrument);
        const persisted = updated.responses.find(item => item.questionId === questionId);
        if (!persisted)
            throw new PreliminaryAssessmentError('invalid_response');
        await this.responses.saveForOwner(persisted, accountId);
        return persisted;
    }
}
