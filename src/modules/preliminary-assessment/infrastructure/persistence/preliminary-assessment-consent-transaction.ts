import { and, desc, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';

type DrizzleTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/**
 * Locks authorization in Consent's order: account, then current published notice.
 * Call before locking or writing the assessment row so both consent withdrawal
 * and notice supersession are ordered against the protected write.
 */
export async function requireCurrentPreliminaryAssessmentConsent(
  tx: DrizzleTransaction,
  accountId: string,
  expectedNoticeVersionId: string | undefined,
  checkedAt: Date,
): Promise<string> {
  const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts)
    .where(eq(authAccounts.id, accountId)).for('share').limit(1);
  if (!account) throw new PreliminaryAssessmentError('consent_required');

  const [currentNotice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
    eq(consentNoticeVersions.purpose, 'preliminary_assessment'),
    eq(consentNoticeVersions.status, 'published'),
    lte(consentNoticeVersions.effectiveAt, checkedAt),
  )).for('share').limit(1);
  const [latestDecision] = await tx.select({
    action: accountConsentEvents.action,
    noticeVersionId: accountConsentEvents.noticeVersionId,
  }).from(accountConsentEvents).where(and(
    eq(accountConsentEvents.accountId, accountId),
    eq(accountConsentEvents.purpose, 'preliminary_assessment'),
  )).orderBy(desc(accountConsentEvents.sequence)).limit(1);

  if (!currentNotice || latestDecision?.action !== 'granted' ||
    latestDecision.noticeVersionId !== currentNotice.id ||
    (expectedNoticeVersionId !== undefined && currentNotice.id !== expectedNoticeVersionId)) {
    throw new PreliminaryAssessmentError('consent_required');
  }
  return currentNotice.id;
}
