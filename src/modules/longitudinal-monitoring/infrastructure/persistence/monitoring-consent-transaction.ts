import { and, desc, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { monitoringConsentPurpose } from '../../domain/model/monitoring-contracts.js';
import { MonitoringError } from '../../domain/model/monitoring-errors.js';

type DrizzleTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/**
 * Takes locks in Consent's order: account first, then notice. Consent decisions
 * take auth_accounts FOR UPDATE before reading/locking the notice. Callers must
 * invoke this before locking or updating an enrollment/session row.
 */
export async function requireCurrentMonitoringConsent(
  tx: DrizzleTransaction,
  accountId: string,
  expectedNoticeVersionId: string,
): Promise<Date> {
  try {
    const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts)
      .where(eq(authAccounts.id, accountId)).for('share').limit(1);
    if (!account) throw new MonitoringError('consent_required');

    const checkedAt = new Date();
    const [notice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.id, expectedNoticeVersionId),
      eq(consentNoticeVersions.purpose, monitoringConsentPurpose),
      eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, checkedAt),
    )).for('share').limit(1);
    const [decision] = await tx.select({ action: accountConsentEvents.action, noticeVersionId: accountConsentEvents.noticeVersionId, createdAt: accountConsentEvents.createdAt })
      .from(accountConsentEvents).where(and(
        eq(accountConsentEvents.accountId, accountId),
        eq(accountConsentEvents.purpose, monitoringConsentPurpose),
      )).orderBy(desc(accountConsentEvents.sequence)).limit(1);

    if (!notice || decision?.action !== 'granted' || decision.noticeVersionId !== notice.id) {
      throw new MonitoringError('consent_required');
    }
    return decision.createdAt;
  } catch (error) {
    if (error instanceof MonitoringError) throw error;
    throw new MonitoringError('consent_unavailable');
  }
}
