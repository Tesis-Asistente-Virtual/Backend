import { and, desc, eq, gt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import type { ConsentPurpose } from '../../../consent/domain/model/consent.js';
import { conversationalSignalAnalyses } from '../../../conversations/infrastructure/persistence/schema.js';
import { conversationalSignalAnalysisSchema, type ConversationalSignalAnalysis } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';
import { ReferralConfirmationInvalid, ReferralConsentRequired, ReferralNotFound, ReferralSourceUnavailable, ReferralStateConflict } from '../../application/referral-errors.js';
import { psychologicalReferralConsentPurpose } from '../../application/referral-policy.js';
import type { DraftResult, PsychologicalReferralRepository, ReferralRecord, ReserveReferralSendResult } from '../../application/ports/referral-repository.js';
import { psychologicalReferralReportSchema } from '../../domain/model/psychological-referral.js';
import { psychologicalReferrals } from './schema.js';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function requireCurrentConsent(tx: Tx, accountId: string, purpose: ConsentPurpose, now: Date): Promise<string> {
  const [notice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
    eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now),
  )).for('share').limit(1);
  if (!notice) throw new ReferralConsentRequired();
  const [decision] = await tx.select({ action: accountConsentEvents.action, noticeVersionId: accountConsentEvents.noticeVersionId })
    .from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, purpose)))
    .orderBy(desc(accountConsentEvents.sequence)).limit(1);
  if (decision?.action !== 'granted' || decision.noticeVersionId !== notice.id) throw new ReferralConsentRequired();
  return notice.id;
}

function sourceFromPayload(payload: unknown): ConversationalSignalAnalysis {
  return conversationalSignalAnalysisSchema.parse(payload);
}

function mapRecord(row: typeof psychologicalReferrals.$inferSelect): ReferralRecord {
  return {
    referralId: row.referralId, accountId: row.accountId, recipient: row.recipient,
    previewHash: row.previewHash,
    report: row.report === null ? null : psychologicalReferralReportSchema.parse(row.report),
    status: row.status as ReferralRecord['status'], createdAt: row.createdAt,
    sentAt: row.sentAt, deliveryReference: row.deliveryReference,
    sendIdempotencyKey: row.sendIdempotencyKey,
  };
}

export class DrizzlePsychologicalReferralRepository implements PsychologicalReferralRepository {
  constructor(private readonly db: Db) {}

  async createDraft(input: Parameters<PsychologicalReferralRepository['createDraft']>[0]): Promise<DraftResult> {
    return this.db.transaction(async tx => {
      const noticeId = await requireCurrentConsent(tx, input.accountId, psychologicalReferralConsentPurpose, input.now);
      let source: ConversationalSignalAnalysis | null = null;
      if (input.sourceAnalysisId) {
        await requireCurrentConsent(tx, input.accountId, 'conversational_signal_analysis', input.now);
        const [row] = await tx.select({ payload: conversationalSignalAnalyses.payload }).from(conversationalSignalAnalyses).where(and(
          eq(conversationalSignalAnalyses.analysisId, input.sourceAnalysisId),
          eq(conversationalSignalAnalyses.accountId, input.accountId), gt(conversationalSignalAnalyses.expiresAt, input.now),
        )).for('share').limit(1);
        if (!row) throw new ReferralSourceUnavailable();
        source = sourceFromPayload(row.payload);
      }

      const [existing] = await tx.select().from(psychologicalReferrals).where(and(
        eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.createIdempotencyKey, input.idempotencyKey),
      )).for('update').limit(1);
      if (existing) {
        const record = mapRecord(existing);
        const sameIntent = record.recipient === input.recipient && record.report?.reason === (input.reason ?? null) &&
          record.report?.sourceAnalysisId === (input.sourceAnalysisId ?? null);
        if (!sameIntent) throw new ReferralStateConflict();
        return { created: false, record };
      }

      const report = input.report(source);
      const previewHash = input.previewHash(source);
      const [inserted] = await tx.insert(psychologicalReferrals).values({
        referralId: input.referralId, accountId: input.accountId,
        sourceAnalysisId: source?.analysisId ?? null, sourceAnalysisAttached: source !== null,
        consentNoticeVersionId: noticeId, status: 'draft', recipient: input.recipient,
        reason: input.reason, report, previewHash, createIdempotencyKey: input.idempotencyKey,
        createdAt: input.now, updatedAt: input.now,
      }).onConflictDoNothing({ target: [psychologicalReferrals.accountId, psychologicalReferrals.createIdempotencyKey] })
        .returning();
      if (inserted) return { created: true, record: mapRecord(inserted) };
      const [raced] = await tx.select().from(psychologicalReferrals).where(and(
        eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.createIdempotencyKey, input.idempotencyKey),
      )).for('update').limit(1);
      if (!raced) throw new ReferralStateConflict();
      const record = mapRecord(raced);
      if (record.recipient !== input.recipient || record.report?.reason !== (input.reason ?? null) || record.report?.sourceAnalysisId !== (input.sourceAnalysisId ?? null)) {
        throw new ReferralStateConflict();
      }
      return { created: false, record };
    });
  }

  async getForOwner(input: { accountId: string; referralId: string; now: Date }): Promise<ReferralRecord | null> {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(psychologicalReferrals).where(and(
        eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.referralId, input.referralId),
      )).for('share').limit(1);
      if (!row) return null;
      const record = mapRecord(row);
      if (record.status === 'cancelled') return record;
      await requireCurrentConsent(tx, input.accountId, psychologicalReferralConsentPurpose, input.now);
      if (row.sourceAnalysisAttached) {
        await requireCurrentConsent(tx, input.accountId, 'conversational_signal_analysis', input.now);
        const sourceAnalysisId = record.report?.sourceAnalysisId;
        if (!sourceAnalysisId) throw new ReferralSourceUnavailable();
        const [source] = await tx.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses).where(and(
          eq(conversationalSignalAnalyses.analysisId, sourceAnalysisId), eq(conversationalSignalAnalyses.accountId, input.accountId),
          gt(conversationalSignalAnalyses.expiresAt, input.now),
        )).for('share').limit(1);
        if (!source) throw new ReferralSourceUnavailable();
      }
      return record;
    });
  }

  async reserveSend(input: Parameters<PsychologicalReferralRepository['reserveSend']>[0]): Promise<ReserveReferralSendResult | null> {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(psychologicalReferrals).where(and(
        eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.referralId, input.referralId),
      )).for('update').limit(1);
      if (!row) return null;
      const record = mapRecord(row);
      if (record.status === 'cancelled') throw new ReferralNotFound();
      await requireCurrentConsent(tx, input.accountId, psychologicalReferralConsentPurpose, input.now);
      if (row.sourceAnalysisAttached) {
        await requireCurrentConsent(tx, input.accountId, 'conversational_signal_analysis', input.now);
        const sourceAnalysisId = record.report?.sourceAnalysisId;
        if (!sourceAnalysisId) throw new ReferralSourceUnavailable();
        const [source] = await tx.select({ id: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses).where(and(
          eq(conversationalSignalAnalyses.analysisId, sourceAnalysisId), eq(conversationalSignalAnalyses.accountId, input.accountId),
          gt(conversationalSignalAnalyses.expiresAt, input.now),
        )).for('share').limit(1);
        if (!source) throw new ReferralSourceUnavailable();
      }
      if (record.status === 'sent') {
        if (record.sendIdempotencyKey === input.idempotencyKey && record.previewHash === input.previewHash && record.recipient === input.recipient) {
          return { kind: 'already_sent', record };
        }
        throw new ReferralStateConflict();
      }
      if (record.status !== 'draft') throw new ReferralStateConflict();
      if (record.previewHash !== input.previewHash || record.recipient !== input.recipient || !record.report) throw new ReferralConfirmationInvalid();
      const [updated] = await tx.update(psychologicalReferrals).set({
        status: 'sending', sendIdempotencyKey: input.idempotencyKey, sendAttemptId: input.attemptId, updatedAt: input.now,
      }).where(and(
        eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.referralId, input.referralId),
        eq(psychologicalReferrals.status, 'draft'), eq(psychologicalReferrals.previewHash, input.previewHash),
      )).returning();
      return updated ? { kind: 'reserved', record: mapRecord(updated), attemptId: input.attemptId } : null;
    });
  }

  async markSent(input: Parameters<PsychologicalReferralRepository['markSent']>[0]): Promise<void> {
    const [row] = await this.db.update(psychologicalReferrals).set({
      status: 'sent', sentAt: input.now, deliveryReference: input.messageId, updatedAt: input.now,
    }).where(and(
      eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.referralId, input.referralId),
      eq(psychologicalReferrals.sendAttemptId, input.attemptId), eq(psychologicalReferrals.status, 'sending'),
    )).returning({ referralId: psychologicalReferrals.referralId });
    if (!row) throw new ReferralStateConflict();
  }

  async markDeliveryFailed(input: Parameters<PsychologicalReferralRepository['markDeliveryFailed']>[0]): Promise<void> {
    await this.db.update(psychologicalReferrals).set({ status: input.outcome, updatedAt: new Date() }).where(and(
      eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.referralId, input.referralId),
      eq(psychologicalReferrals.sendAttemptId, input.attemptId), eq(psychologicalReferrals.status, 'sending'),
    ));
  }

  async cancelDraft(input: { accountId: string; referralId: string; now: Date }): Promise<boolean> {
    const [row] = await this.db.update(psychologicalReferrals).set({
      status: 'cancelled', sourceAnalysisId: null, sourceAnalysisAttached: false,
      reason: null, report: null, previewHash: null, updatedAt: input.now,
    }).where(and(
      eq(psychologicalReferrals.accountId, input.accountId), eq(psychologicalReferrals.referralId, input.referralId),
      eq(psychologicalReferrals.status, 'draft'),
    )).returning({ referralId: psychologicalReferrals.referralId });
    return Boolean(row);
  }
}
