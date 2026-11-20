import { and, desc, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { ConsentIdempotencyConflict } from '../../domain/model/consent-errors.js';
import { consentActions, consentPurposes, type AccountConsentEvent, type ConsentAction, type ConsentNoticeVersion, type ConsentPurpose, type ConsentStatus } from '../../domain/model/consent.js';
import type { ConsentRepository } from '../../domain/repositories/consent-repository.js';
import { accountConsentEvents, consentNoticeVersions } from './schema.js';

function event(row: typeof accountConsentEvents.$inferSelect): AccountConsentEvent {
  if (!consentPurposes.includes(row.purpose as ConsentPurpose) || !consentActions.includes(row.action as ConsentAction)) throw new Error('Stored consent event has invalid values');
  return { ...row, sequence: Number(row.sequence), purpose: row.purpose as ConsentPurpose, action: row.action as ConsentAction };
}
function notice(row: typeof consentNoticeVersions.$inferSelect): ConsentNoticeVersion {
  if (!consentPurposes.includes(row.purpose as ConsentPurpose)) throw new Error('Stored consent notice has invalid purpose');
  return { ...row, purpose: row.purpose as ConsentPurpose, status: row.status as ConsentNoticeVersion['status'] };
}

export class DrizzleConsentRepository implements ConsentRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listAvailableNotices(now: Date): Promise<ConsentNoticeVersion[]> {
    const rows = await this.db.select().from(consentNoticeVersions).where(and(eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now)));
    return rows.map(notice);
  }

  async getStatus(accountId: string, now: Date): Promise<ConsentStatus[]> {
    const notices = await this.listAvailableNotices(now);
    const results: ConsentStatus[] = [];
    for (const purpose of consentPurposes) {
      const currentNotice = notices.find(item => item.purpose === purpose);
      const [latest] = await this.db.select().from(accountConsentEvents)
        .where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, purpose)))
        .orderBy(desc(accountConsentEvents.sequence)).limit(1);
      const latestAction = latest && consentActions.includes(latest.action as ConsentAction) ? latest.action as ConsentAction : undefined;
      const versionMatches = currentNotice?.id === latest?.noticeVersionId;
      const state: ConsentStatus['state'] = !latestAction || !versionMatches
        ? latestAction === 'granted' ? 'renewal_required' : 'not_decided'
        : latestAction;
      results.push({ purpose, state, currentNoticeVersion: currentNotice?.version ?? null, changedAt: latest?.createdAt ?? null });
    }
    return results;
  }

  async recordDecision(accountId: string, purpose: ConsentPurpose, noticeVersionId: string, action: ConsentAction, idempotencyKey: string, now: Date): Promise<AccountConsentEvent | null> {
    return this.db.transaction(async tx => {
      const [existing] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) {
        if (existing.purpose !== purpose || existing.noticeVersionId !== noticeVersionId || existing.action !== action) throw new ConsentIdempotencyConflict();
        return event(existing);
      }
      await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('update');
      const [validNotice] = await tx.select().from(consentNoticeVersions).where(and(
        eq(consentNoticeVersions.id, noticeVersionId), eq(consentNoticeVersions.purpose, purpose),
        eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now),
      )).for('share').limit(1);
      if (!validNotice) return null;
      const [inserted] = await tx.insert(accountConsentEvents).values({ accountId, purpose, noticeVersionId, action, idempotencyKey }).onConflictDoNothing().returning();
      if (inserted) return event(inserted);
      const [retry] = await tx.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.idempotencyKey, idempotencyKey))).limit(1);
      if (!retry || retry.purpose !== purpose || retry.noticeVersionId !== noticeVersionId || retry.action !== action) throw new ConsentIdempotencyConflict();
      return event(retry);
    });
  }
}
