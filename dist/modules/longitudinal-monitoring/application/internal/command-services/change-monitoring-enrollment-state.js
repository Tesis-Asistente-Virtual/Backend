import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import { completeMonitoring, pauseMonitoring, resumeMonitoring, withdrawMonitoring, monitoringConsentPurpose } from '../../../domain/model/monitoring-contracts.js';
export class ChangeMonitoringEnrollmentState {
    enrollments;
    consent;
    clock;
    constructor(enrollments, consent, clock = () => new Date()) {
        this.enrollments = enrollments;
        this.consent = consent;
        this.clock = clock;
    }
    async execute(enrollmentId, accountId, action) {
        const current = await this.enrollments.findByIdForOwner(enrollmentId, accountId);
        if (!current)
            throw new MonitoringError('enrollment_not_found');
        if (action === 'resume') {
            let authorization;
            try {
                authorization = await this.consent.getCurrentAuthorization(accountId);
            }
            catch {
                throw new MonitoringError('consent_unavailable');
            }
            if (!authorization || authorization.purpose !== monitoringConsentPurpose || authorization.state !== 'granted' ||
                authorization.noticeVersionId !== current.consentNoticeVersionId || !authorization.grantedAt) {
                throw new MonitoringError('consent_required');
            }
            if (current.status === 'active')
                return current;
            const at = new Date(Math.max(this.clock().getTime(), authorization.checkedAt.getTime(), current.updatedAt.getTime()));
            const next = resumeMonitoring(current, authorization, at);
            if (!await this.enrollments.saveStatusForOwnerWithCurrentConsent(next, accountId, current.revision, current.consentNoticeVersionId))
                throw new MonitoringError('concurrent_modification');
            return next;
        }
        if ((action === 'pause' && current.status === 'paused') ||
            (action === 'withdraw' && current.status === 'withdrawn') ||
            (action === 'complete' && current.status === 'completed'))
            return current;
        const at = new Date(Math.max(this.clock().getTime(), current.updatedAt.getTime()));
        const next = action === 'pause' ? pauseMonitoring(current, at)
            : action === 'withdraw' ? withdrawMonitoring(current, at)
                : action === 'complete' ? completeMonitoring(current, at)
                    : (() => { throw new MonitoringError('invalid_transition'); })();
        if (!await this.enrollments.saveStatusForOwner(next, accountId, current.revision))
            throw new MonitoringError('concurrent_modification');
        return next;
    }
}
export class PauseMonitoringEnrollment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(enrollmentId, accountId) { return this.state.execute(enrollmentId, accountId, 'pause'); }
}
export class ResumeMonitoringEnrollment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(enrollmentId, accountId) { return this.state.execute(enrollmentId, accountId, 'resume'); }
}
export class WithdrawMonitoringEnrollment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(enrollmentId, accountId) { return this.state.execute(enrollmentId, accountId, 'withdraw'); }
}
export class CompleteMonitoringEnrollment {
    state;
    constructor(state) {
        this.state = state;
    }
    execute(enrollmentId, accountId) { return this.state.execute(enrollmentId, accountId, 'complete'); }
}
