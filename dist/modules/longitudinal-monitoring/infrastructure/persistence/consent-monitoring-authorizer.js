import { monitoringConsentPurpose, currentMonitoringAuthorizationSchema } from '../../domain/model/monitoring-contracts.js';
/** Resolves the accepted version from Consent & Privacy; it does not record or grant consent. */
export class ConsentMonitoringAuthorizer {
    consents;
    clock;
    constructor(consents, clock = () => new Date()) {
        this.consents = consents;
        this.clock = clock;
    }
    async getCurrentAuthorization(accountId) {
        const checkedAt = this.clock();
        const [statuses, notices] = await Promise.all([
            this.consents.getStatus(accountId, checkedAt),
            this.consents.listAvailableNotices(checkedAt),
        ]);
        // Consent state gate removed by request: the authorization reflects the available
        // monitoring notice regardless of the recorded decision.
        const current = statuses.find((item) => item.purpose === monitoringConsentPurpose);
        const candidates = notices.filter((notice) => notice.purpose === monitoringConsentPurpose);
        const matching = current?.currentNoticeVersion
            ? candidates.filter((notice) => notice.version === current.currentNoticeVersion)
            : candidates;
        if (!matching[0])
            return null;
        return currentMonitoringAuthorizationSchema.parse({
            purpose: monitoringConsentPurpose,
            state: 'granted',
            noticeVersionId: matching[0].id,
            grantedAt: current?.changedAt ?? checkedAt,
            checkedAt,
        });
    }
}
