import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { assertDass21ScoreWriteAuthorization, dass21AssessmentScoreSchema, type Dass21AssessmentScore } from '../../domain/model/dass21-assessment-score.js';
import type { Dass21AssessmentScoreRepository } from '../../domain/repositories/dass21-assessment-score-repository.js';
import { requireCurrentPreliminaryAssessmentConsent } from './preliminary-assessment-consent-transaction.js';
import { accountConsentEvents } from '../../../consent/infrastructure/persistence/schema.js';
import { assessmentPsychometricScores, assessmentScoringMappingVersions, preliminaryAssessments } from './schema.js';

function toDomain(row: typeof assessmentPsychometricScores.$inferSelect): Dass21AssessmentScore {
  return dass21AssessmentScoreSchema.parse({
    schemaVersion: row.schemaVersion, status: row.status, assessmentId: row.assessmentId, accountId: row.accountId,
    instrumentCode: 'DASS-21', instrumentId: row.instrumentId, instrumentVersionId: row.instrumentVersionId,
    mappingId: row.mappingId, mappingVersion: row.mappingVersion, scoringVersion: row.scoringVersion, calculatedAt: row.calculatedAt,
    dimensions: {
      depression: { rawScore: row.depressionRawScore, equivalentScore: row.depressionEquivalentScore },
      anxiety: { rawScore: row.anxietyRawScore, equivalentScore: row.anxietyEquivalentScore },
      stress: { rawScore: row.stressRawScore, equivalentScore: row.stressEquivalentScore },
    },
  });
}

function toValues(score: Dass21AssessmentScore) {
  return {
    assessmentId: score.assessmentId, accountId: score.accountId,
    instrumentId: score.instrumentId, instrumentVersionId: score.instrumentVersionId,
    mappingId: score.mappingId, mappingVersion: score.mappingVersion, scoringVersion: score.scoringVersion, schemaVersion: score.schemaVersion,
    status: score.status,
    depressionRawScore: score.dimensions.depression.rawScore,
    depressionEquivalentScore: score.dimensions.depression.equivalentScore,
    anxietyRawScore: score.dimensions.anxiety.rawScore,
    anxietyEquivalentScore: score.dimensions.anxiety.equivalentScore,
    stressRawScore: score.dimensions.stress.rawScore,
    stressEquivalentScore: score.dimensions.stress.equivalentScore,
    calculatedAt: score.calculatedAt,
  };
}

function sameCalculatedResult(left: Dass21AssessmentScore, right: Dass21AssessmentScore): boolean {
  const { calculatedAt: _leftAt, ...leftCalculation } = left;
  const { calculatedAt: _rightAt, ...rightCalculation } = right;
  return isDeepStrictEqual(leftCalculation, rightCalculation);
}

export class DrizzleDass21AssessmentScoreRepository implements Dass21AssessmentScoreRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async saveForCompletedOwner(scoreValue: Dass21AssessmentScore, accountId: string): Promise<Dass21AssessmentScore> {
    const parsed = dass21AssessmentScoreSchema.safeParse(scoreValue);
    if (!parsed.success || parsed.data.accountId !== accountId) throw new PreliminaryAssessmentError('assessment_not_found');
    const score = parsed.data;
    return this.db.transaction(async tx => {
      const currentNotice = await requireCurrentPreliminaryAssessmentConsent(tx, accountId, undefined, score.calculatedAt);
      const [assessment] = await tx.select().from(preliminaryAssessments).where(and(
        eq(preliminaryAssessments.assessmentId, score.assessmentId),
        eq(preliminaryAssessments.accountId, accountId),
      )).for('update').limit(1);
      if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');

      const [mapping] = await tx.select().from(assessmentScoringMappingVersions).where(and(
        eq(assessmentScoringMappingVersions.instrumentVersionId, score.instrumentVersionId),
        eq(assessmentScoringMappingVersions.mappingVersion, score.mappingVersion),
        eq(assessmentScoringMappingVersions.status, 'frozen'),
      )).for('share').limit(1);
      const [latestDecision] = await tx.select({ action: accountConsentEvents.action, noticeVersionId: accountConsentEvents.noticeVersionId })
        .from(accountConsentEvents).where(and(
          eq(accountConsentEvents.accountId, accountId),
          eq(accountConsentEvents.purpose, 'preliminary_assessment'),
        )).orderBy(desc(accountConsentEvents.sequence)).limit(1);
      assertDass21ScoreWriteAuthorization({ score, requestedAccountId: accountId, assessment,
        currentNoticeVersionId: currentNotice, latestDecision: latestDecision ?? null, mapping: mapping ?? null });
      const values = toValues(score);
      const [inserted] = await tx.insert(assessmentPsychometricScores).values(values)
        .onConflictDoNothing({ target: assessmentPsychometricScores.assessmentId })
        .returning({ id: assessmentPsychometricScores.scoreId });
      if (inserted) return score;
      const [existing] = await tx.select().from(assessmentPsychometricScores)
        .where(eq(assessmentPsychometricScores.assessmentId, score.assessmentId)).limit(1);
      if (!existing) throw new PreliminaryAssessmentError('result_conflict');
      const persisted = toDomain(existing);
      if (!sameCalculatedResult(persisted, score)) throw new PreliminaryAssessmentError('result_conflict');
      return persisted;
    });
  }

  async findByAssessmentForOwner(assessmentId: string, accountId: string): Promise<Dass21AssessmentScore | null> {
    const [row] = await this.db.select().from(assessmentPsychometricScores).where(and(
      eq(assessmentPsychometricScores.assessmentId, assessmentId),
      eq(assessmentPsychometricScores.accountId, accountId),
    )).limit(1);
    return row ? toDomain(row) : null;
  }
}
