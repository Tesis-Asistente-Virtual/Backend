import { randomUUID } from 'node:crypto';
import type { RecommendationGenerator } from '../ports/recommendation-generator.js';
import type { RecommendationRepository } from '../ports/recommendation-repository.js';
import { RecommendationGenerationError } from '../ports/recommendation-generator.js';
import { RecommendationsAnalysisUnavailable, RecommendationsGenerationInProgress, RecommendationsPersistenceConflict, RecommendationsUnavailable } from '../recommendation-errors.js';
import { buildGeneralRecommendations, getEligibleSignalDimensions, recommendationSetSchema, type RecommendationCard, type RecommendationSet } from '../../domain/model/recommendation-set.js';

export interface RecommendationsPolicy {
  readonly enabled: boolean;
  readonly deployment: string | undefined;
  readonly allowedAccountIds: readonly string[];
}

export class RecommendationService {
  constructor(
    private readonly repository: RecommendationRepository,
    private readonly generator: RecommendationGenerator | null,
    private readonly policy: RecommendationsPolicy,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async generate(accountIdValue: string, request: { analysisId?: string }, signal?: AbortSignal): Promise<{ recommendations: RecommendationSet; created: boolean }> {
    const accountId = accountIdValue.toLowerCase();
    this.assertEnabled(accountId);
    if (signal?.aborted) throw new RecommendationGenerationError('cancelled');
    const now = this.clock();
    const generationToken = this.createId();
    const reserved = await this.repository.reserve({
      accountId, analysisId: request.analysisId, now, generationToken,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
    });
    if (reserved.kind === 'unavailable') throw new RecommendationsAnalysisUnavailable();
    if (reserved.kind === 'in_progress') throw new RecommendationsGenerationInProgress();
    if (reserved.kind === 'existing') return { recommendations: reserved.recommendations, created: false };

    try {
      const eligible = getEligibleSignalDimensions(reserved.analysis);
      const hasHighEvidence = (['depression', 'anxiety', 'stress'] as const)
        .some(dimension => reserved.analysis.signals[dimension].level === 'high');
      let result: RecommendationSet;
      if (eligible.length === 0) {
        result = buildGeneralRecommendations({
          recommendationSetId: reserved.recommendationSetId,
          sourceAnalysisId: reserved.analysis.analysisId,
          generatedAt: now,
          expiresAt: reserved.expiresAt,
          hasHighEvidence,
          createId: this.createId,
        });
      } else {
        if (!this.generator) throw new RecommendationsUnavailable();
        const generated = await this.generator.generate({
          sourceAnalysisVersion: reserved.analysis.analysisVersion,
          eligibleSignals: eligible.map(({ dimension, signal: item }) => ({
            dimension, level: item.level, indicators: item.indicators,
            summary: item.summary, observedPattern: item.observedPattern,
            evidence: item.evidence.map((evidence, evidenceIndex) => ({
              reference: `${dimension}:${evidenceIndex}`,
              paraphrase: evidence.paraphrase,
            })),
          })),
        }, signal);
        result = recommendationSetSchema.parse({
          contractVersion: 'wellbeing-recommendations-1.0',
          recommendationSetId: reserved.recommendationSetId,
          status: 'available',
          sourceAnalysisId: reserved.analysis.analysisId,
          generatedAt: now.toISOString(),
          expiresAt: reserved.expiresAt.toISOString(),
          recommendations: generated.recommendations.map(item => this.buildEvidenceCard(item, reserved.analysis.analysisId, eligible)),
          professionalSupportNotice: hasHighEvidence
            ? 'Si lo deseas, puedes conversar con un profesional de salud mental. Este análisis describe evidencia textual exploratoria; no evalúa riesgo ni reemplaza atención profesional.'
            : null,
          isDiagnostic: false,
          isClinicalAdvice: false,
          limitations: [
            'exploratory_conversational_evidence_only', 'not_a_diagnosis_or_clinical_assessment',
            'not_a_crisis_detector', 'not_a_substitute_for_professional_care', 'generated_from_persisted_analysis_not_messages',
          ],
        });
      }
      if (signal?.aborted) throw new RecommendationGenerationError('cancelled');
      const saved = await this.repository.complete({
        accountId, analysisId: reserved.analysis.analysisId, generationToken, now, recommendations: result,
      });
      if (!saved) throw new RecommendationsPersistenceConflict();
      return { recommendations: saved, created: true };
    } catch (error) {
      await this.repository.release({ accountId, analysisId: reserved.analysis.analysisId, generationToken });
      throw error;
    }
  }

  async latest(accountIdValue: string) {
    const accountId = accountIdValue.toLowerCase();
    this.assertEnabled(accountId);
    const latest = await this.repository.latest({ accountId, now: this.clock() });
    return latest ?? { status: 'not_available' as const, reason: 'no_current_recommendations' as const, isDiagnostic: false as const };
  }

  private assertEnabled(accountId: string): void {
    if (!this.policy.enabled || this.policy.deployment !== 'authorized_pilot' ||
      !this.policy.allowedAccountIds.includes(accountId)) throw new RecommendationsUnavailable();
  }

  private buildEvidenceCard(
    item: { title: string; description: string; dimension: 'depression' | 'anxiety' | 'stress'; evidenceReferences: string[] },
    sourceAnalysisId: string,
    eligible: ReturnType<typeof getEligibleSignalDimensions>,
  ): RecommendationCard {
    const signal = eligible.find(candidate => candidate.dimension === item.dimension)?.signal;
    if (!signal) throw new RecommendationGenerationError('invalid_response');
    const uniqueRefs = new Set(item.evidenceReferences);
    if (uniqueRefs.size !== item.evidenceReferences.length) throw new RecommendationGenerationError('invalid_response');
    const evidenceReferences = item.evidenceReferences.map(reference => {
      const match = /^(depression|anxiety|stress):(\d+)$/.exec(reference);
      if (!match || match[1] !== item.dimension) throw new RecommendationGenerationError('invalid_response');
      const evidenceIndex = Number(match[2]);
      if (!Number.isSafeInteger(evidenceIndex) || evidenceIndex < 0 || !signal.evidence[evidenceIndex]) {
        throw new RecommendationGenerationError('invalid_response');
      }
      return { dimension: item.dimension, evidenceIndex };
    });
    return {
      id: this.createId(), kind: 'evidence_based', title: item.title, description: item.description,
      dimension: item.dimension,
      justification: `Se vincula con evidencia exploratoria de ${item.dimension} registrada en el análisis de origen. Las referencias permiten revisar esa evidencia en el resultado original.`,
      sourceAnalysisId, evidenceReferences,
    };
  }
}
