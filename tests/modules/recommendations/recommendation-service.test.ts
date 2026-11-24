import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RecommendationGenerator } from '../../../src/modules/recommendations/application/ports/recommendation-generator.js';
import type { RecommendationRepository } from '../../../src/modules/recommendations/application/ports/recommendation-repository.js';
import { RecommendationService } from '../../../src/modules/recommendations/application/internal/recommendation-service.js';
import { RecommendationsUnavailable } from '../../../src/modules/recommendations/application/recommendation-errors.js';
import type { PersistedSourceAnalysis, RecommendationSet } from '../../../src/modules/recommendations/domain/model/recommendation-set.js';

const ownerId = '550e8400-e29b-41d4-a716-446655440001';
const sourceId = '550e8400-e29b-41d4-a716-446655440010';
const messageId = '550e8400-e29b-41d4-a716-446655440020';
const now = new Date('2026-11-24T12:00:00.000Z');
const source: PersistedSourceAnalysis = {
  analysisId: sourceId, conversationId: '550e8400-e29b-41d4-a716-446655440002', accountId: ownerId,
  status: 'available', source: 'conversation_user_messages', analysisVersion: 'conversational-signals-1.0.0',
  modelVersion: 'mock-model', analyzedAt: now.toISOString(), period: { start: now.toISOString(), end: now.toISOString() },
  coverage: { selectedMessageCount: 1, analyzedUserMessageCount: 1, excludedNonUserMessageCount: 0, basis: 'selected_messages_only' },
  signals: {
    depression: { level: 'low', evidenceCount: 1, indicators: ['reduced_interest'], summary: 'Interés reducido reportado en un ejemplo sintético.', observedPattern: 'single_report', evidence: [{ paraphrase: 'Mencionó dejar de disfrutar una actividad.', messageId }] },
    anxiety: { level: 'insufficient_evidence', evidenceCount: 0, indicators: [], summary: 'No hay evidencia suficiente.', observedPattern: 'insufficient_evidence', evidence: [] },
    stress: { level: 'insufficient_evidence', evidenceCount: 0, indicators: [], summary: 'No hay evidencia suficiente.', observedPattern: 'insufficient_evidence', evidence: [] },
  },
  overallSummary: 'Ejemplo sintético.', suggestedNextStep: 'optional_reflection', reviewStatus: 'not_professionally_reviewed',
  isDiagnostic: false, isValidatedClinicalScale: false,
  limitations: ['textual_observations_only', 'not_a_diagnosis', 'levels_describe_evidence_not_clinical_severity', 'not_a_safety_assessment', 'absence_of_mentions_is_not_evidence_of_absence', 'not_derived_from_dass21', 'not_professionally_reviewed'],
  sourceExpiresAt: new Date('2027-02-22T12:00:00.000Z'),
};

function serviceFixture(input: { analysis?: PersistedSourceAnalysis; existing?: RecommendationSet; generator?: RecommendationGenerator | null } = {}) {
  const analysis = input.analysis ?? source;
  const repository: RecommendationRepository = {
    reserve: vi.fn(async ({ generationToken }) => input.existing
      ? { kind: 'existing' as const, recommendations: input.existing }
      : { kind: 'claimed' as const, recommendationSetId: randomUUID(), generationToken, analysis, expiresAt: analysis.sourceExpiresAt }),
    complete: vi.fn(async ({ recommendations }) => recommendations),
    release: vi.fn(async () => undefined),
    latest: vi.fn(async () => input.existing ?? null),
  };
  const generated = {
    recommendations: [0, 1, 2].map(index => ({
      title: `Sugerencia ${index + 1}`, description: 'Prueba una acción pequeña que te resulte conveniente.', dimension: 'depression' as const,
      evidenceReferences: ['depression:0'],
    })),
  };
  const generator: RecommendationGenerator = input.generator ?? {
    modelVersion: 'mock-model',
    generate: vi.fn(async () => generated),
  };
  const policy = { enabled: true, deployment: 'authorized_pilot', allowedAccountIds: [ownerId] };
  return { service: new RecommendationService(repository, generator, policy, () => now), repository, generator };
}

describe('RecommendationService', () => {
  it('creates 3 evidence-based cards from the persisted low/moderate analysis only', async () => {
    const { service, generator } = serviceFixture();
    const result = await service.generate(ownerId, {});
    expect(result.created).toBe(true);
    expect(result.recommendations.recommendations).toHaveLength(3);
    expect(result.recommendations.recommendations.every(item => item.dimension === 'depression' && item.evidenceReferences[0]?.evidenceIndex === 0)).toBe(true);
    expect(result.recommendations.isDiagnostic).toBe(false);
    expect(result.recommendations.isClinicalAdvice).toBe(false);
    expect(generator.generate).toHaveBeenCalledOnce();
    const input = vi.mocked(generator.generate).mock.calls[0]?.[0];
    expect(input?.eligibleSignals.map(item => item.dimension)).toEqual(['depression']);
    expect(JSON.stringify(input)).not.toContain(ownerId);
    expect(JSON.stringify(input)).not.toContain(messageId);
  });

  it('returns only general guidance when every dimension has insufficient evidence and skips OpenAI', async () => {
    const allInsufficient: PersistedSourceAnalysis = {
      ...source,
      signals: Object.fromEntries(['depression', 'anxiety', 'stress'].map(dimension => [dimension, {
        level: 'insufficient_evidence', evidenceCount: 0, indicators: [], summary: 'No hay evidencia suficiente.',
        observedPattern: 'insufficient_evidence', evidence: [],
      }])) as PersistedSourceAnalysis['signals'],
    };
    const { service, generator } = serviceFixture({ analysis: allInsufficient });
    const { recommendations } = await service.generate(ownerId, {});
    expect(recommendations.recommendations).toHaveLength(3);
    expect(recommendations.recommendations.every(item => item.kind === 'general' && item.dimension === null && item.evidenceReferences.length === 0)).toBe(true);
    expect(recommendations.recommendations[0]?.justification).toContain('no indica presencia ni ausencia');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('does not derive self-help from high evidence and adds voluntary professional-support wording', async () => {
    const high: PersistedSourceAnalysis = {
      ...source,
      signals: {
        ...source.signals,
        depression: { level: 'high', evidenceCount: 3, indicators: ['low_mood'], summary: 'Reportes reiterados en datos sintéticos.', observedPattern: 'recurring_across_messages', evidence: [0, 1, 2].map(index => ({ paraphrase: `Referencia sintética ${index}.`, messageId: randomUUID() })) },
      },
    };
    const { service, generator } = serviceFixture({ analysis: high });
    const result = await service.generate(ownerId, {});
    expect(result.recommendations.recommendations.every(item => item.kind === 'general')).toBe(true);
    expect(result.recommendations.professionalSupportNotice).toContain('Si lo deseas');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('returns the existing set idempotently without another provider call', async () => {
    const { service, generator } = serviceFixture();
    const created = await service.generate(ownerId, {});
    const secondFixture = serviceFixture({ existing: created.recommendations });
    const second = await secondFixture.service.generate(ownerId, {});
    expect(second.created).toBe(false);
    expect(second.recommendations.recommendationSetId).toBe(created.recommendations.recommendationSetId);
    expect(generator.generate).toHaveBeenCalledOnce();
    expect(secondFixture.generator.generate).not.toHaveBeenCalled();
  });

  it('rejects accounts outside the server allowlist before repository access', async () => {
    const { service, repository } = serviceFixture();
    await expect(service.generate(randomUUID(), {})).rejects.toBeInstanceOf(RecommendationsUnavailable);
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('rejects model references that do not resolve to the persisted source evidence', async () => {
    const badGenerator: RecommendationGenerator = {
      modelVersion: 'mock-model', generate: vi.fn(async () => ({ recommendations: [0, 1, 2].map(index => ({
        title: `Sugerencia ${index}`, description: 'Acción pequeña.', dimension: 'depression' as const,
        evidenceReferences: ['anxiety:99'],
      })) })),
    };
    const { service, repository } = serviceFixture({ generator: badGenerator });
    await expect(service.generate(ownerId, {})).rejects.toThrow('Recommendation generation failed');
    expect(repository.release).toHaveBeenCalledOnce();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
