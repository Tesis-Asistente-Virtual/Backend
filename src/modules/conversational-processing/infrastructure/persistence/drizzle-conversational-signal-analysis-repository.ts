import { and, asc, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { conversations, conversationMessages, conversationalSignalAnalyses } from '../../../conversations/infrastructure/persistence/schema.js';
import { conversationalSignalAnalysisSchema, type ConversationalSignalAnalysis } from '../../domain/model/conversational-signal-analysis.js';
import type { ConversationalSignalAnalysisRepository } from '../../domain/repositories/conversational-signal-analysis-repository.js';
import { ConversationalSignalAnalysisConsentRequired } from '../../application/internal/command-services/analyze-authorized-conversation-signals.js';

const requiredPurposes = ['ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis'] as const;

type AnalysisDatabase = NodePgDatabase<typeof schema>;

async function currentNoticeForPurpose(tx: Parameters<Parameters<AnalysisDatabase['transaction']>[0]>[0], accountId: string, purpose: typeof requiredPurposes[number], at: Date): Promise<string | null> {
  const [notice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
    eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, at),
  )).for('share').limit(1);
  if (!notice) return null;
  const [decision] = await tx.select({ action: accountConsentEvents.action, noticeVersionId: accountConsentEvents.noticeVersionId })
    .from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, purpose)))
    .orderBy(desc(accountConsentEvents.sequence)).limit(1);
  return decision?.action === 'granted' && decision.noticeVersionId === notice.id ? notice.id : null;
}

async function authorizeTransaction(tx: Parameters<Parameters<AnalysisDatabase['transaction']>[0]>[0], accountId: string, at: Date): Promise<string> {
  const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('share').limit(1);
  if (!account) throw new ConversationalSignalAnalysisConsentRequired();
  let analysisNoticeId: string | null = null;
  for (const purpose of requiredPurposes) {
    const noticeId = await currentNoticeForPurpose(tx, accountId, purpose, at);
    if (!noticeId) throw new ConversationalSignalAnalysisConsentRequired();
    if (purpose === 'conversational_signal_analysis') analysisNoticeId = noticeId;
  }
  if (!analysisNoticeId) throw new ConversationalSignalAnalysisConsentRequired();
  return analysisNoticeId;
}

/** Los análisis guardados antes de la puntuación no tienen `score`: se leen como null. */
function withLegacyScores(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !('signals' in payload) || typeof payload.signals !== 'object' || payload.signals === null) return payload;
  const signals = Object.fromEntries(Object.entries(payload.signals).map(([dimension, signal]) =>
    [dimension, typeof signal === 'object' && signal !== null && !('score' in signal) ? { ...signal, score: null } : signal]));
  return { ...payload, signals };
}

function parsePayload(payload: unknown): ConversationalSignalAnalysis {
  return conversationalSignalAnalysisSchema.parse(withLegacyScores(payload));
}

export class DrizzleConversationalSignalAnalysisRepository implements ConversationalSignalAnalysisRepository {
  constructor(private readonly db: AnalysisDatabase, private readonly clock: () => Date = () => new Date()) {}

  async saveForOwnerWithCurrentConsent(input: { analysis: ConversationalSignalAnalysis; expiresAt: Date; userMessageIds: readonly string[] }): Promise<ConversationalSignalAnalysis | null> {
    return this.db.transaction(async tx => {
      const now = this.clock();
      const noticeId = await authorizeTransaction(tx, input.analysis.accountId, now);
      const [conversation] = await tx.select({ id: conversations.id }).from(conversations).where(and(
        eq(conversations.id, input.analysis.conversationId), eq(conversations.accountId, input.analysis.accountId),
      )).for('share').limit(1);
      if (!conversation) return null;
      if (input.userMessageIds.length > 0) {
        const rows = await tx.select({ id: conversationMessages.id }).from(conversationMessages).where(and(
          eq(conversationMessages.conversationId, input.analysis.conversationId), eq(conversationMessages.role, 'user'),
          eq(conversationMessages.status, 'completed'), inArray(conversationMessages.id, [...input.userMessageIds]),
        )).for('share');
        if (rows.length !== input.userMessageIds.length) return null;
      }
      await tx.delete(conversationalSignalAnalyses).where(and(
        eq(conversationalSignalAnalyses.accountId, input.analysis.accountId), lte(conversationalSignalAnalyses.expiresAt, now),
      ));
      const [saved] = await tx.insert(conversationalSignalAnalyses).values({
        analysisId: input.analysis.analysisId,
        accountId: input.analysis.accountId,
        conversationId: input.analysis.conversationId,
        consentNoticeVersionId: noticeId,
        analysisVersion: input.analysis.analysisVersion,
        modelVersion: input.analysis.modelVersion,
        analyzedAt: new Date(input.analysis.analyzedAt),
        periodStart: input.analysis.period.start ? new Date(input.analysis.period.start) : null,
        periodEnd: input.analysis.period.end ? new Date(input.analysis.period.end) : null,
        expiresAt: input.expiresAt,
        payload: input.analysis,
      }).returning({ payload: conversationalSignalAnalyses.payload });
      return saved ? parsePayload(saved.payload) : null;
    });
  }

  async findLatestForOwnerWithCurrentConsent(accountId: string): Promise<ConversationalSignalAnalysis | null> {
    return this.db.transaction(async tx => {
      const now = this.clock();
      await authorizeTransaction(tx, accountId, now);
      await tx.delete(conversationalSignalAnalyses).where(and(eq(conversationalSignalAnalyses.accountId, accountId), lte(conversationalSignalAnalyses.expiresAt, now)));
      const [row] = await tx.select({ payload: conversationalSignalAnalyses.payload }).from(conversationalSignalAnalyses).where(and(
        eq(conversationalSignalAnalyses.accountId, accountId), gt(conversationalSignalAnalyses.expiresAt, now),
      )).orderBy(desc(conversationalSignalAnalyses.analyzedAt), desc(conversationalSignalAnalyses.analysisId)).limit(1);
      return row ? parsePayload(row.payload) : null;
    });
  }

  async listRecentForOwnerWithCurrentConsent(accountId: string, limit: number): Promise<ConversationalSignalAnalysis[]> {
    return this.db.transaction(async tx => {
      const now = this.clock();
      await authorizeTransaction(tx, accountId, now);
      await tx.delete(conversationalSignalAnalyses).where(and(eq(conversationalSignalAnalyses.accountId, accountId), lte(conversationalSignalAnalyses.expiresAt, now)));
      const rows = await tx.select({ payload: conversationalSignalAnalyses.payload }).from(conversationalSignalAnalyses).where(and(
        eq(conversationalSignalAnalyses.accountId, accountId), gt(conversationalSignalAnalyses.expiresAt, now),
      )).orderBy(desc(conversationalSignalAnalyses.analyzedAt), desc(conversationalSignalAnalyses.analysisId)).limit(limit);
      return rows.map(row => parsePayload(row.payload));
    });
  }

  /** Deletes only expired rows from this module's own table, in one bounded transaction. */
  async purgeExpiredBatch(asOf: Date, limit: number, ownerAccountId?: string): Promise<number> {
    if (Number.isNaN(asOf.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 500 ||
        (ownerAccountId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerAccountId))) {
      throw new Error('Invalid expired-analysis purge boundary');
    }
    return this.db.transaction(async tx => {
      const candidates = await tx.select({ analysisId: conversationalSignalAnalyses.analysisId })
        .from(conversationalSignalAnalyses)
        .where(and(
          lte(conversationalSignalAnalyses.expiresAt, asOf),
          ...(ownerAccountId ? [eq(conversationalSignalAnalyses.accountId, ownerAccountId)] : []),
        ))
        .orderBy(asc(conversationalSignalAnalyses.expiresAt), asc(conversationalSignalAnalyses.analysisId))
        .limit(limit);
      const ids = candidates.map(row => row.analysisId);
      if (ids.length === 0) return 0;
      const deleted = await tx.delete(conversationalSignalAnalyses).where(and(
        inArray(conversationalSignalAnalyses.analysisId, ids),
        lte(conversationalSignalAnalyses.expiresAt, asOf),
        ...(ownerAccountId ? [eq(conversationalSignalAnalyses.accountId, ownerAccountId)] : []),
      )).returning({ analysisId: conversationalSignalAnalyses.analysisId });
      return deleted.length;
    });
  }
}
