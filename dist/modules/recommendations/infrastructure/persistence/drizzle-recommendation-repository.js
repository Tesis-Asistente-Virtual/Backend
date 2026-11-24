import { and, desc, eq, gt, lte } from 'drizzle-orm';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { conversationalSignalAnalyses } from '../../../conversations/infrastructure/persistence/schema.js';
import { conversationalSignalAnalysisSchema } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';
import { RecommendationsConsentRequired } from '../../application/recommendation-errors.js';
import { recommendationConsentPurposes, resolveCurrentRecommendationConsentNotice } from '../../application/recommendation-consent-policy.js';
import { recommendationSetSchema } from '../../domain/model/recommendation-set.js';
import { wellbeingRecommendations } from './schema.js';
async function currentRecommendationsNotice(tx, accountId, now) {
    const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, accountId)).for('share').limit(1);
    if (!account)
        throw new RecommendationsConsentRequired();
    const statuses = [];
    for (const purpose of recommendationConsentPurposes) {
        const [notice] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now))).for('share').limit(1);
        if (!notice) {
            statuses.push({ purpose, currentNoticeId: null, latestAction: null, latestNoticeId: null });
            continue;
        }
        const [decision] = await tx.select({ action: accountConsentEvents.action, noticeVersionId: accountConsentEvents.noticeVersionId })
            .from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, purpose)))
            .orderBy(desc(accountConsentEvents.sequence)).limit(1);
        statuses.push({ purpose, currentNoticeId: notice.id, latestAction: decision?.action ?? null, latestNoticeId: decision?.noticeVersionId ?? null });
    }
    const recommendationsNoticeId = resolveCurrentRecommendationConsentNotice(statuses);
    if (!recommendationsNoticeId)
        throw new RecommendationsConsentRequired();
    return recommendationsNoticeId;
}
function parseSource(row) {
    return {
        ...conversationalSignalAnalysisSchema.parse(row.payload),
        sourceExpiresAt: row.expiresAt,
    };
}
function parseSet(value) { return recommendationSetSchema.parse(value); }
export class DrizzleRecommendationRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async reserve(input) {
        return this.db.transaction(async (tx) => {
            const noticeId = await currentRecommendationsNotice(tx, input.accountId, input.now);
            await tx.delete(wellbeingRecommendations).where(and(eq(wellbeingRecommendations.accountId, input.accountId), lte(wellbeingRecommendations.expiresAt, input.now)));
            const [source] = await tx.select().from(conversationalSignalAnalyses).where(and(eq(conversationalSignalAnalyses.accountId, input.accountId), ...(input.analysisId ? [eq(conversationalSignalAnalyses.analysisId, input.analysisId)] : []), gt(conversationalSignalAnalyses.expiresAt, input.now))).orderBy(desc(conversationalSignalAnalyses.analyzedAt), desc(conversationalSignalAnalyses.analysisId)).for('share').limit(1);
            if (!source)
                return { kind: 'unavailable' };
            const [existing] = await tx.select().from(wellbeingRecommendations).where(eq(wellbeingRecommendations.sourceAnalysisId, source.analysisId)).for('update').limit(1);
            if (existing?.status === 'available' && existing.payload !== null && existing.expiresAt > input.now) {
                return { kind: 'existing', recommendations: parseSet(existing.payload) };
            }
            if (existing && existing.leaseExpiresAt > input.now)
                return { kind: 'in_progress' };
            if (existing) {
                const [claimed] = await tx.update(wellbeingRecommendations).set({
                    status: 'generating', generationToken: input.generationToken, leaseExpiresAt: input.leaseExpiresAt,
                    consentNoticeVersionId: noticeId, generatedAt: null, payload: null, updatedAt: input.now,
                }).where(eq(wellbeingRecommendations.recommendationSetId, existing.recommendationSetId)).returning({ recommendationSetId: wellbeingRecommendations.recommendationSetId });
                if (!claimed)
                    return { kind: 'in_progress' };
                return { kind: 'claimed', recommendationSetId: claimed.recommendationSetId, generationToken: input.generationToken, analysis: parseSource(source), expiresAt: source.expiresAt };
            }
            const [inserted] = await tx.insert(wellbeingRecommendations).values({
                accountId: input.accountId, sourceAnalysisId: source.analysisId, consentNoticeVersionId: noticeId,
                status: 'generating', generationToken: input.generationToken, leaseExpiresAt: input.leaseExpiresAt,
                expiresAt: source.expiresAt, createdAt: input.now, updatedAt: input.now,
            }).onConflictDoNothing({ target: wellbeingRecommendations.sourceAnalysisId })
                .returning({ recommendationSetId: wellbeingRecommendations.recommendationSetId });
            if (!inserted) {
                const [raced] = await tx.select().from(wellbeingRecommendations).where(eq(wellbeingRecommendations.sourceAnalysisId, source.analysisId)).for('update').limit(1);
                if (raced?.status === 'available' && raced.payload !== null)
                    return { kind: 'existing', recommendations: parseSet(raced.payload) };
                return { kind: 'in_progress' };
            }
            return { kind: 'claimed', recommendationSetId: inserted.recommendationSetId, generationToken: input.generationToken, analysis: parseSource(source), expiresAt: source.expiresAt };
        });
    }
    async complete(input) {
        return this.db.transaction(async (tx) => {
            const noticeId = await currentRecommendationsNotice(tx, input.accountId, input.now);
            const [source] = await tx.select({ expiresAt: conversationalSignalAnalyses.expiresAt }).from(conversationalSignalAnalyses).where(and(eq(conversationalSignalAnalyses.analysisId, input.analysisId), eq(conversationalSignalAnalyses.accountId, input.accountId), gt(conversationalSignalAnalyses.expiresAt, input.now))).for('share').limit(1);
            if (!source || source.expiresAt.getTime() !== new Date(input.recommendations.expiresAt).getTime())
                return null;
            const [row] = await tx.update(wellbeingRecommendations).set({
                status: 'available', generatedAt: input.now, payload: input.recommendations,
                leaseExpiresAt: source.expiresAt, updatedAt: input.now,
            }).where(and(eq(wellbeingRecommendations.accountId, input.accountId), eq(wellbeingRecommendations.sourceAnalysisId, input.analysisId), eq(wellbeingRecommendations.generationToken, input.generationToken), eq(wellbeingRecommendations.status, 'generating'), eq(wellbeingRecommendations.consentNoticeVersionId, noticeId), gt(wellbeingRecommendations.expiresAt, input.now))).returning({ payload: wellbeingRecommendations.payload });
            return row?.payload ? parseSet(row.payload) : null;
        });
    }
    async release(input) {
        await this.db.delete(wellbeingRecommendations).where(and(eq(wellbeingRecommendations.accountId, input.accountId), eq(wellbeingRecommendations.sourceAnalysisId, input.analysisId), eq(wellbeingRecommendations.generationToken, input.generationToken), eq(wellbeingRecommendations.status, 'generating')));
    }
    async latest(input) {
        return this.db.transaction(async (tx) => {
            await currentRecommendationsNotice(tx, input.accountId, input.now);
            await tx.delete(wellbeingRecommendations).where(and(eq(wellbeingRecommendations.accountId, input.accountId), lte(wellbeingRecommendations.expiresAt, input.now)));
            const [row] = await tx.select({ payload: wellbeingRecommendations.payload }).from(wellbeingRecommendations)
                .innerJoin(conversationalSignalAnalyses, and(eq(conversationalSignalAnalyses.analysisId, wellbeingRecommendations.sourceAnalysisId), eq(conversationalSignalAnalyses.accountId, wellbeingRecommendations.accountId))).where(and(eq(wellbeingRecommendations.accountId, input.accountId), eq(wellbeingRecommendations.status, 'available'), gt(wellbeingRecommendations.expiresAt, input.now), gt(conversationalSignalAnalyses.expiresAt, input.now))).orderBy(desc(wellbeingRecommendations.generatedAt)).limit(1);
            return row?.payload ? parseSet(row.payload) : null;
        });
    }
}
