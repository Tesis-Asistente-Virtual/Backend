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
        const current = statuses.find((item) => item.purpose === monitoringConsentPurpose);
        if (!current || current.state !== 'granted' || !current.currentNoticeVersion || !current.changedAt)
            return null;
        const matching = notices.filter((notice) => notice.purpose === monitoringConsentPurpose && notice.version === current.currentNoticeVersion);
        if (matching.length !== 1 || !matching[0])
            return null;
        return currentMonitoringAuthorizationSchema.parse({
            purpose: monitoringConsentPurpose,
            state: 'granted',
            noticeVersionId: matching[0].id,
            grantedAt: current.changedAt,
            checkedAt,
        });
    }
}
