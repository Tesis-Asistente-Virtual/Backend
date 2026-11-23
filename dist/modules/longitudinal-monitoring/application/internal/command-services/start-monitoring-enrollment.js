import { randomUUID } from 'node:crypto';
import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import { createMonitoringEnrollment, monitoringContractVersion, monitoringConsentPurpose } from '../../../domain/model/monitoring-contracts.js';
export class StartMonitoringEnrollment {
    enrollments;
    consent;
    clock;
    newId;
    constructor(enrollments, consent, clock = () => new Date(), newId = randomUUID) {
        this.enrollments = enrollments;
        this.consent = consent;
        this.clock = clock;
        this.newId = newId;
    }
    async execute(accountId, explicitOptIn) {
        let authorization;
        try {
            authorization = await this.consent.getCurrentAuthorization(accountId);
        }
        catch {
            throw new MonitoringError('consent_unavailable');
        }
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
