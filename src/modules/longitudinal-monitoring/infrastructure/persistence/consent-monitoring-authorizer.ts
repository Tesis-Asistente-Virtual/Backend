import type { MonitoringConsentAuthorizer } from '../../application/ports/monitoring-consent-authorizer.js';
import { monitoringConsentPurpose, currentMonitoringAuthorizationSchema } from '../../domain/model/monitoring-contracts.js';
import type { ConsentRepository } from '../../../consent/domain/repositories/consent-repository.js';

/** Resolves the accepted version from Consent & Privacy; it does not record or grant consent. */
export class ConsentMonitoringAuthorizer implements MonitoringConsentAuthorizer {
  constructor(private readonly consents: ConsentRepository, private readonly clock: () => Date = () => new Date()) {}

  async getCurrentAuthorization(accountId: string) {
    const checkedAt = this.clock();
    const [statuses, notices] = await Promise.all([
      this.consents.getStatus(accountId, checkedAt),
      this.consents.listAvailableNotices(checkedAt),
    ]);
    const current = statuses.find((item) => item.purpose === monitoringConsentPurpose);
    if (!current || current.state !== 'granted' || !current.currentNoticeVersion || !current.changedAt) return null;
    const matching = notices.filter((notice) => notice.purpose === monitoringConsentPurpose && notice.version === current.currentNoticeVersion);
    if (matching.length !== 1 || !matching[0]) return null;
    return currentMonitoringAuthorizationSchema.parse({
      purpose: monitoringConsentPurpose,
      state: 'granted',
      noticeVersionId: matching[0].id,
      grantedAt: current.changedAt,
      checkedAt,
    });
  }
}
