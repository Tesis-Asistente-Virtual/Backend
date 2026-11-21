import { randomUUID } from 'node:crypto';
import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import { startMonitoringSession, monitoringConsentPurpose } from '../../../domain/model/monitoring-contracts.js';
import type { MonitoringEnrollmentRepository } from '../../../domain/repositories/monitoring-enrollment-repository.js';
import type { MonitoringSessionRepository } from '../../../domain/repositories/monitoring-session-repository.js';
import type { MonitoringConsentAuthorizer } from '../../ports/monitoring-consent-authorizer.js';

export class CreateMonitoringSession {
  constructor(
    private readonly enrollments: MonitoringEnrollmentRepository,
    private readonly sessions: MonitoringSessionRepository,
    private readonly consent: MonitoringConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async execute(enrollmentId: string, accountId: string) {
    const enrollment = await this.enrollments.findByIdForOwner(enrollmentId, accountId);
    if (!enrollment) throw new MonitoringError('enrollment_not_found');
    let authorization;
    try { authorization = await this.consent.getCurrentAuthorization(accountId); }
    catch { throw new MonitoringError('consent_unavailable'); }
    if (!authorization || authorization.purpose !== monitoringConsentPurpose || authorization.state !== 'granted' ||
      authorization.noticeVersionId !== enrollment.consentNoticeVersionId || !authorization.grantedAt) {
      throw new MonitoringError('consent_required');
    }
    const at = new Date(Math.max(this.clock().getTime(), authorization.checkedAt.getTime(), enrollment.updatedAt.getTime()));
    return this.sessions.createWithCurrentConsent(startMonitoringSession(enrollment, this.newId(), at), enrollment.consentNoticeVersionId);
  }
}
