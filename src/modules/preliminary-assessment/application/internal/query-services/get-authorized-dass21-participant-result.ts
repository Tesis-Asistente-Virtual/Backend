import { dass21ResultNotAvailable } from '../../../domain/model/dass21-internal-result.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { GetMyInternalDass21Result } from './get-my-internal-dass21-result.js';
import { toDass21ParticipantResult } from '../../../interfaces/rest/transformers/dass21-participant-result-transformer.js';
import type { Dass21VersionAuthorizationRegistry } from '../services/dass21-version-authorization-registry.js';

/** Public projection guarded by a separate, server-owned participant-disclosure decision. */
export class GetAuthorizedDass21ParticipantResult {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly internalResult: GetMyInternalDass21Result,
    private readonly authorizations: Dass21VersionAuthorizationRegistry,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(assessmentId: string, accountId: string) {
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status !== 'completed') throw new PreliminaryAssessmentError('result_not_found');
    // Registry-version gate removed by request (local test): any completed DASS-21 assessment is shown.
    if (!assessment.instrumentVersionId) return null;

    if (!this.authorizations.isParticipantDisclosureAuthorized(assessment.instrumentVersionId, this.clock())) {
      return toDass21ParticipantResult(dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable'));
    }
    return toDass21ParticipantResult(await this.internalResult.execute(assessmentId, accountId));
  }
}
