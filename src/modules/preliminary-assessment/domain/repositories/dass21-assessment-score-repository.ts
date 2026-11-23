import type { Dass21AssessmentScore } from '../model/dass21-assessment-score.js';

/** Internal write port. There is deliberately no public score-query port in this increment. */
export interface Dass21AssessmentScoreRepository {
  /** Returns the durable record, including the original calculation timestamp on an idempotent retry. */
  saveForCompletedOwner(score: Dass21AssessmentScore, accountId: string): Promise<Dass21AssessmentScore>;
}
