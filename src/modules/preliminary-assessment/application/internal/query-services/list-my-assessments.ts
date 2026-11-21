import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';

export class ListMyAssessments {
  constructor(private readonly assessments: PreliminaryAssessmentRepository) {}
  execute(accountId: string, limit: number, offset: number) {
    return this.assessments.listByOwner(accountId, limit, offset);
  }
}
