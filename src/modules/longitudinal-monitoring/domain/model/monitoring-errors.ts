export type MonitoringErrorCode =
  | 'consent_required'
  | 'consent_unavailable'
  | 'enrollment_not_found'
  | 'invalid_transition'
  | 'enrollment_inactive'
  | 'enrollment_already_open'
  | 'session_already_open'
  | 'concurrent_modification'
  | 'session_not_found'
  | 'session_inactive'
  | 'conversation_not_found'
  | 'conversation_inactive'
  | 'conversation_already_associated'
  | 'conversation_association_not_authorized';

export class MonitoringError extends Error {
  constructor(readonly code: MonitoringErrorCode) {
    super('Longitudinal monitoring operation failed');
    this.name = 'MonitoringError';
  }
}
