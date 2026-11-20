import { and, desc, eq, lte } from 'drizzle-orm';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { ConsentIdempotencyConflict } from '../../domain/model/consent-errors.js';
import { consentActions, consentPurposes } from '../../domain/model/consent.js';
import { accountConsentEvents, consentNoticeVersions } from './schema.js';
function event(row) {
    if (!consentPurposes.includes(row.purpose) || !consentActions.includes(row.action))
        throw new Error('Stored consent event has invalid values');
    return { ...row, sequence: Number(row.sequence), purpose: row.purpose, action: row.action };
}
function notice(row) {
    if (!consentPurposes.includes(row.purpose))
        throw new Error('Stored consent notice has invalid purpose');
    return { ...row, purpose: row.purpose, status: row.status };
}
export class DrizzleConsentRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async listAvailableNotices(now) {
        const rows = await this.db.select().from(consentNoticeVersions).where(and(eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now)));
        return rows.map(notice);
    }
    async getStatus(accountId, now) {
        const notices = await this.listAvailableNotices(now);
        const results = [];
        for (const purpose of consentPurposes) {
            const currentNotice = notices.find(item => item.purpose === purpose);
            const [latest] = await this.db.select().from(accountConsentEvents)
                .where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, purpose)))
                .orderBy(desc(accountConsentEvents.sequence)).limit(1);
            const latestAction = latest && consentActions.includes(latest.action) ? latest.action : undefined;
            const versionMatches = currentNotice?.id === latest?.noticeVersionId;
            const state = !latestAction || !versionMatches
                ? latestAction === 'granted' ? 'renewal_required' : 'not_decided'
                : latestAction;
            results.push({ purpose, state, currentNoticeVersion: currentNotice?.version ?? null, changedAt: latest?.createdAt ?? null });
        }
        return results;
    }
    async recordDecision(accountId, purpose, noticeVersionId, action, idempotencyKey, now) {
        return this.db.transaction(async (tx) => {
            const [existing] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.idempotencyKey, idempotencyKey))).limit(1);
            if (existing) {
                if (existing.purpose !== purpose || existing.noticeVersionId !== noticeVersionId || existing.action !== action)
                    throw new ConsentIdempotencyConflict();
                return event(existing);
            }
            await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('update');
            const [validNotice] = await tx.select().from(consentNoticeVersions).where(and(eq(consentNoticeVersions.id, noticeVersionId), eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now))).for('share').limit(1);
            if (!validNotice)
                return null;
            const [inserted] = await tx.insert(accountConsentEvents).values({ accountId, purpose, noticeVersionId, action, idempotencyKey }).onConflictDoNothing().returning();
            if (inserted)
                return event(inserted);
            const [retry] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.idempotencyKey, idempotencyKey))).limit(1);
            if (!retry || retry.purpose !== purpose || retry.noticeVersionId !== noticeVersionId || retry.action !== action)
                throw new ConsentIdempotencyConflict();
            return event(retry);
        });
    }
}
