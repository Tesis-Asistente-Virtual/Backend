export type MonitoringErrorCode =
  | 'consent_required'
  | 'consent_unavailable'
  | 'enrollment_not_found'
  | 'invalid_transition'
  | 'enrollment_inactive'
  | 'enrollment_already_open'
  | 'session_already_open'
  | 'concurrent_modification';

export class MonitoringError extends Error {
  constructor(readonly code: MonitoringErrorCode) {
    super('Longitudinal monitoring operation failed');
    this.name = 'MonitoringError';
  }
}
