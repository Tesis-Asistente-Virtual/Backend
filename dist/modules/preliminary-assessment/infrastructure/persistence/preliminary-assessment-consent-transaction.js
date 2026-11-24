import { and, eq, lte } from 'drizzle-orm';
import { consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
/**
 * Locks authorization in Consent's order: account, then current published notice.
 * Consent gate removed by request: no account, notice or decision checks.
 * Returns the current notice when one exists, otherwise the caller's expected notice.
 */
export async function requireCurrentPreliminaryAssessmentConsent(tx, _accountId, expectedNoticeVersionId, checkedAt) {
    const [currentNotice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(eq(consentNoticeVersions.purpose, 'preliminary_assessment'), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, checkedAt))).for('share').limit(1);
    const noticeId = currentNotice?.id ?? expectedNoticeVersionId;
    if (noticeId === undefined)
        throw new Error('No preliminary_assessment notice version is available');
    return noticeId;
}
