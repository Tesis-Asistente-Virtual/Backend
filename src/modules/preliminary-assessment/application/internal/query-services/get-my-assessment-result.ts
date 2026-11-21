import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { AssessmentResultRepository } from '../../../domain/repositories/assessment-result-repository.js';

export class GetMyAssessmentResult {
  constructor(private readonly assessments: PreliminaryAssessmentRepository, private readonly results: AssessmentResultRepository) {}
  async execute(assessmentId: string, accountId: string) {
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status !== 'completed') throw new PreliminaryAssessmentError('result_not_found');
    const result = await this.results.findByAssessmentForOwner(assessmentId, accountId);
    if (!result) throw new PreliminaryAssessmentError('result_not_found');
    return result;
  }
}
