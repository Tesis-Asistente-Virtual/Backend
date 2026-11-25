export type AssessmentDomainErrorCode =
  | 'invalid_assessment'
  | 'invalid_transition'
  | 'assessment_closed'
  | 'invalid_response'
  | 'duplicate_response'
  | 'instrument_unavailable'
  | 'instrument_version_mismatch'
  | 'responses_incomplete'
  | 'assessment_not_found'
  | 'result_not_found'
  | 'concurrent_modification'
  | 'result_conflict'
  | 'consent_required'
  | 'daily_limit_reached';

/** Safe domain error: its message and code never contain answers or other sensitive data. */
export class PreliminaryAssessmentError extends Error {
  constructor(readonly code: AssessmentDomainErrorCode) {
    super('Preliminary assessment operation is invalid');
    this.name = 'PreliminaryAssessmentError';
  }
}
