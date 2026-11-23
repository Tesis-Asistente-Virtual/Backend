import { randomUUID } from 'node:crypto';
import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import { startMonitoringSession, monitoringConsentPurpose } from '../../../domain/model/monitoring-contracts.js';
export class CreateMonitoringSession {
    enrollments;
    sessions;
    consent;
    clock;
    newId;
    constructor(enrollments, sessions, consent, clock = () => new Date(), newId = randomUUID) {
        this.enrollments = enrollments;
        this.sessions = sessions;
        this.consent = consent;
        this.clock = clock;
        this.newId = newId;
    }
    async execute(enrollmentId, accountId) {
        const enrollment = await this.enrollments.findByIdForOwner(enrollmentId, accountId);
        if (!enrollment)
            throw new MonitoringError('enrollment_not_found');
        let authorization;
        try {
            authorization = await this.consent.getCurrentAuthorization(accountId);
        }
        catch {
            throw new MonitoringError('consent_unavailable');
        }
        if (!authorization || authorization.purpose !== monitoringConsentPurpose || authorization.state !== 'granted' ||
            authorization.noticeVersionId !== enrollment.consentNoticeVersionId || !authorization.grantedAt) {
            throw new MonitoringError('consent_required');
        }
        const at = new Date(Math.max(this.clock().getTime(), authorization.checkedAt.getTime(), enrollment.updatedAt.getTime()));
        return this.sessions.createWithCurrentConsent(startMonitoringSession(enrollment, this.newId(), at), enrollment.consentNoticeVersionId);
    }
}
