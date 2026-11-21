import type { PreliminaryAssessmentResult } from '../model/assessment-result.js';

export interface AssessmentResultRepository {
  /** Result creation is idempotent only for an identical result; conflicting content is rejected. */
  saveForCompletedOwner(result: PreliminaryAssessmentResult, accountId: string): Promise<void>;
  findByAssessmentForOwner(assessmentId: string, accountId: string): Promise<PreliminaryAssessmentResult | null>;
}
