import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
export class GetMyAssessment {
    assessments;
    constructor(assessments) {
        this.assessments = assessments;
    }
    async execute(assessmentId, accountId) {
        const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        return assessment;
    }
}
