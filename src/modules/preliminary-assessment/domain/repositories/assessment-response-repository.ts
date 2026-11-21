import type { AssessmentResponse } from '../model/assessment-response.js';

/** Stores one current response per (assessmentId, instrumentVersionId, questionId); saves are replace/upsert operations. */
export interface AssessmentResponseRepository {
  saveForOwner(response: AssessmentResponse, accountId: string): Promise<void>;
  listForAssessmentOwner(assessmentId: string, accountId: string): Promise<readonly AssessmentResponse[]>;
}
