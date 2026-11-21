import type { MonitoringSession } from '../model/monitoring-contracts.js';

export interface MonitoringSessionRepository {
  /** Opens only while the owning enrollment row is active and locked. */
  create(session: MonitoringSession): Promise<MonitoringSession>;
  /** Revalidates current consent before taking the enrollment lock and inserting the session. */
  createWithCurrentConsent(session: MonitoringSession, consentNoticeVersionId: string): Promise<MonitoringSession>;
  findByIdForOwner(sessionId: string, accountId: string): Promise<MonitoringSession | null>;
  listByEnrollmentForOwner(enrollmentId: string, accountId: string, pagination: { limit: number; offset: number }): Promise<readonly MonitoringSession[]>;
  /** CAS update of a closed session; false means stale revision or non-owner. */
  saveStatusForOwner(session: MonitoringSession, accountId: string, expectedRevision: number): Promise<boolean>;
}
