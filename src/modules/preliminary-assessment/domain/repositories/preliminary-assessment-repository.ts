import type { PreliminaryAssessment } from '../model/preliminary-assessment.js';
import type { PreliminaryAssessmentResult } from '../model/assessment-result.js';

/** Domain persistence contract; implementations must always scope reads and writes by accountId. */
export interface PreliminaryAssessmentRepository {
  create(assessment: PreliminaryAssessment): Promise<void>;
  findByIdForOwner(assessmentId: string, accountId: string): Promise<PreliminaryAssessment | null>;
  /** Compare-and-swap using the aggregate's prior updatedAt; false means another write won. */
  saveForOwner(assessment: PreliminaryAssessment, accountId: string, expectedUpdatedAt: Date): Promise<boolean>;
  /** Atomically persist final status and its unique result using an optimistic version check. */
  completeWithResultForOwner(assessment: PreliminaryAssessment, result: PreliminaryAssessmentResult, accountId: string, expectedUpdatedAt: Date): Promise<boolean>;
  listByOwner(accountId: string, limit: number, offset: number): Promise<readonly PreliminaryAssessment[]>;
}
