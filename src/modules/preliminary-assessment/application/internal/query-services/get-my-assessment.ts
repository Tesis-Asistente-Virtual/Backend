import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';

export class GetMyAssessment {
  constructor(private readonly assessments: PreliminaryAssessmentRepository) {}
  async execute(assessmentId: string, accountId: string) {
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    return assessment;
  }
}
