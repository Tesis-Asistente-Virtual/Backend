import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  categorizeDass21Score,
  DASS21_INTERPRETATION_BASIS,
  DASS21_INTERPRETATION_VERSION,
  Dass21InterpretationError,
  type Dass21InterpretationSupport,
} from '../../../src/modules/preliminary-assessment/domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';

const instrumentVersionId = randomUUID();
const support: Dass21InterpretationSupport = {
  instrumentVersionId,
  scoringVersion: DASS21_SCORING_VERSION,
  interpretationVersion: DASS21_INTERPRETATION_VERSION,
  basis: DASS21_INTERPRETATION_BASIS,
};

function scoreFor(dimension: 'depression' | 'anxiety' | 'stress', rawScore: number, overrides: Record<string, unknown> = {}) {
  const dimensionScore = (raw: number) => ({ rawScore: raw, equivalentScore: raw * 2 });
  return {
    schemaVersion: '1.0',
    status: 'calculated',
    assessmentId: randomUUID(),
    accountId: randomUUID(),
    instrumentCode: 'DASS-21',
    instrumentId: randomUUID(),
    instrumentVersionId,
    mappingId: randomUUID(),
    mappingVersion: 'synthetic-map-1',
    scoringVersion: DASS21_SCORING_VERSION,
    calculatedAt: new Date('2026-04-15T12:00:00.000Z'),
    dimensions: {
      depression: dimensionScore(dimension === 'depression' ? rawScore : 0),
      anxiety: dimensionScore(dimension === 'anxiety' ? rawScore : 0),
      stress: dimensionScore(dimension === 'stress' ? rawScore : 0),
    },
    ...overrides,
  };
}

describe('DASS-21 conventional categorization', () => {
  it.each([
    ['depression', [0, 5, 7, 11, 14]],
    ['anxiety', [0, 4, 5, 8, 10]],
    ['stress', [0, 8, 10, 13, 17]],
  ] as const)('maps all five ranges independently for %s using equivalent-score cutoffs', (dimension, categoryStarts) => {
    const categories = ['normal', 'mild', 'moderate', 'severe', 'extremely_severe'] as const;
    for (const [index, rawScore] of categoryStarts.entries()) {
      const result = categorizeDass21Score(scoreFor(dimension, rawScore), support);
      expect(result.dimensions[dimension]).toEqual({
        rawScore,
        equivalentScore: rawScore * 2,
        category: categories[index],
      });
    }
  });

  it('checks the category boundary immediately below and at each transition', () => {
    const cases = [
      { dimension: 'depression' as const, transitionRawScores: [5, 7, 11, 14] },
      { dimension: 'anxiety' as const, transitionRawScores: [4, 5, 8, 10] },
      { dimension: 'stress' as const, transitionRawScores: [8, 10, 13, 17] },
    ];
    const categories = ['normal', 'mild', 'moderate', 'severe', 'extremely_severe'] as const;
    for (const { dimension, transitionRawScores } of cases) {
      transitionRawScores.forEach((raw, index) => {
        expect(categorizeDass21Score(scoreFor(dimension, raw - 1), support).dimensions[dimension].category).toBe(categories[index]);
        expect(categorizeDass21Score(scoreFor(dimension, raw), support).dimensions[dimension].category).toBe(categories[index + 1]);
      });
    }
  });

  it('preserves raw and equivalent scores, versions, minimum and maximum values without an aggregate category', () => {
    const minimum = categorizeDass21Score(scoreFor('depression', 0), support);
    const maximum = categorizeDass21Score(scoreFor('depression', 21), support);
    expect(minimum.dimensions.depression).toEqual({ rawScore: 0, equivalentScore: 0, category: 'normal' });
    expect(maximum.dimensions.depression).toEqual({ rawScore: 21, equivalentScore: 42, category: 'extremely_severe' });
    expect(minimum).toMatchObject({
      schemaVersion: '1.0',
      interpretationVersion: 'dass21-conventional-cutoffs-1.0',
      interpretationBasis: 'dass-original-manual-conventional-ranges',
      scoringVersion: 'dass21-score-1.0',
      instrumentVersionId,
    });
    expect(minimum).not.toHaveProperty('overallCategory');
  });

  it('is deterministic for the same score and interpretation support', () => {
    const score = scoreFor('anxiety', 10);
    expect(categorizeDass21Score(score, support)).toEqual(categorizeDass21Score(score, support));
  });

  it('refuses missing support and instrument version mismatches', () => {
    expect(() => categorizeDass21Score(scoreFor('stress', 9), undefined)).toThrowError(Dass21InterpretationError);
    expect(() => categorizeDass21Score(scoreFor('stress', 9), { ...support, instrumentVersionId: randomUUID() }))
      .toThrowError(expect.objectContaining({ code: 'instrument_version_mismatch' }));
  });

  it('refuses wrong instruments, unsupported scoring versions, incomplete and inconsistent scores', () => {
    expect(() => categorizeDass21Score(scoreFor('stress', 9, { instrumentCode: 'OTHER' }), support))
      .toThrowError(expect.objectContaining({ code: 'unsupported_instrument' }));
    expect(() => categorizeDass21Score(scoreFor('stress', 9, { scoringVersion: 'dass21-score-0.9' }), support))
      .toThrowError(expect.objectContaining({ code: 'unsupported_scoring_version' }));
    expect(() => categorizeDass21Score({ ...scoreFor('stress', 9), dimensions: undefined }, support))
      .toThrowError(expect.objectContaining({ code: 'invalid_score' }));
    expect(() => categorizeDass21Score(scoreFor('stress', 9, {
      dimensions: {
        depression: { rawScore: 0, equivalentScore: 0 },
        anxiety: { rawScore: 0, equivalentScore: 0 },
        stress: { rawScore: 9, equivalentScore: 17 },
      },
    }), support)).toThrowError(expect.objectContaining({ code: 'invalid_score' }));
  });
});
