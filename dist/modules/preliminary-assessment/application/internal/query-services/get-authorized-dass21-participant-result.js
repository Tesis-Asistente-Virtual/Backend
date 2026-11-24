import { dass21ResultNotAvailable } from '../../../domain/model/dass21-internal-result.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { toDass21ParticipantResult } from '../../../interfaces/rest/transformers/dass21-participant-result-transformer.js';
/** Public projection guarded by a separate, server-owned participant-disclosure decision. */
export class GetAuthorizedDass21ParticipantResult {
    assessments;
    internalResult;
    authorizations;
    clock;
    constructor(assessments, internalResult, authorizations, clock = () => new Date()) {
        this.assessments = assessments;
        this.internalResult = internalResult;
        this.authorizations = authorizations;
        this.clock = clock;
    }
    async execute(assessmentId, accountId) {
        const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (assessment.status !== 'completed')
            throw new PreliminaryAssessmentError('result_not_found');
        if (!assessment.instrumentVersionId || !this.authorizations.getVersion(assessment.instrumentVersionId))
            return null;
        if (!this.authorizations.isParticipantDisclosureAuthorized(assessment.instrumentVersionId, this.clock())) {
            return toDass21ParticipantResult(dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable'));
        }
        return toDass21ParticipantResult(await this.internalResult.execute(assessmentId, accountId));
    }
}
