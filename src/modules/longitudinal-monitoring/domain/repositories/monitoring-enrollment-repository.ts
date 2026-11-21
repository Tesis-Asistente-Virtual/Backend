import type { MonitoringEnrollment } from '../model/monitoring-contracts.js';

export interface MonitoringEnrollmentRepository {
  create(enrollment: MonitoringEnrollment): Promise<MonitoringEnrollment>;
  /** Creates only if the exact consent notice is still current and granted at the write boundary. */
  createWithCurrentConsent(enrollment: MonitoringEnrollment): Promise<MonitoringEnrollment>;
  findByIdForOwner(enrollmentId: string, accountId: string): Promise<MonitoringEnrollment | null>;
  listByOwner(accountId: string, pagination: { limit: number; offset: number }): Promise<readonly MonitoringEnrollment[]>;
  /** CAS update of domain-validated status fields; false means stale revision or non-owner. */
  saveStatusForOwner(enrollment: MonitoringEnrollment, accountId: string, expectedRevision: number): Promise<boolean>;
  /** Revalidates the exact consent notice before the CAS update, using Consent's account-lock order. */
  saveStatusForOwnerWithCurrentConsent(enrollment: MonitoringEnrollment, accountId: string, expectedRevision: number, consentNoticeVersionId: string): Promise<boolean>;
}
