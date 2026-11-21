import { randomUUID } from 'node:crypto';
import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import { createMonitoringEnrollment, monitoringContractVersion, monitoringConsentPurpose } from '../../../domain/model/monitoring-contracts.js';
import type { MonitoringEnrollmentRepository } from '../../../domain/repositories/monitoring-enrollment-repository.js';
import type { MonitoringConsentAuthorizer } from '../../ports/monitoring-consent-authorizer.js';

export class StartMonitoringEnrollment {
  constructor(
    private readonly enrollments: MonitoringEnrollmentRepository,
    private readonly consent: MonitoringConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async execute(accountId: string, explicitOptIn: true) {
    let authorization;
    try { authorization = await this.consent.getCurrentAuthorization(accountId); }
    catch { throw new MonitoringError('consent_unavailable'); }
    if (!authorization || authorization.purpose !== monitoringConsentPurpose || authorization.state !== 'granted' || !authorization.noticeVersionId || !authorization.grantedAt) {
      throw new MonitoringError('consent_required');
    }
    const enrolledAt = new Date(Math.max(this.clock().getTime(), authorization.checkedAt.getTime()));
    const enrollment = createMonitoringEnrollment({
      contractVersion: monitoringContractVersion,
      enrollmentId: this.newId(),
      accountId,
      consentNoticeVersionId: authorization.noticeVersionId,
      enrolledAt,
      explicitOptIn,
    }, authorization);
    return this.enrollments.createWithCurrentConsent(enrollment);
  }
}
