import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
export class GetMyAssessmentResult {
    assessments;
    results;
    constructor(assessments, results) {
        this.assessments = assessments;
        this.results = results;
    }
    async execute(assessmentId, accountId) {
        const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (assessment.status !== 'completed')
            throw new PreliminaryAssessmentError('result_not_found');
        const result = await this.results.findByAssessmentForOwner(assessmentId, accountId);
        if (!result)
            throw new PreliminaryAssessmentError('result_not_found');
        return result;
    }
}
