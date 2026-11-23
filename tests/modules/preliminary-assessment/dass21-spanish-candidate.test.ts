import { describe, expect, it } from 'vitest';
import { DASS21_ITEMS_BY_DIMENSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';
import { parseInstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';
import { GetAssessmentInfo } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-assessment-info.js';
import {
  DASS21_SPANISH_CANDIDATE,
  DASS21_SPANISH_CANDIDATE_VERSION,
  dass21SpanishCandidateSchema,
} from '../../../src/modules/preliminary-assessment/domain/model/dass21-spanish-candidate.js';

describe('Spanish DASS-21 candidate manifest', () => {
  it('preserves the source instructions, 21 ordered prompts, response labels, and internal scoring values', () => {
    expect(DASS21_SPANISH_CANDIDATE.items).toHaveLength(21);
    expect(DASS21_SPANISH_CANDIDATE.items.map(item => item.itemNumber)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(DASS21_SPANISH_CANDIDATE.items.map(item => item.displayOrder)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(new Set(DASS21_SPANISH_CANDIDATE.items.map(item => item.promptOriginal)).size).toBe(21);
    expect(DASS21_SPANISH_CANDIDATE.instructionsOriginal).toContain('durante la semana pasada');
    expect(DASS21_SPANISH_CANDIDATE.referencePeriod).toBe('durante la semana pasada');
    expect(DASS21_SPANISH_CANDIDATE.items[0]?.responseOptions.map(option => option.label)).toEqual([
      'No me aplicó',
      'Me aplicó un poco, o durante parte del tiempo',
      'Me aplicó bastante, o durante una buena parte del tiempo',
      'Me aplicó mucho, o la mayor parte del tiempo',
    ]);
    expect(DASS21_SPANISH_CANDIDATE.items.map(item => item.responseOptions.map(option => option.scoringValue)))
      .toEqual(Array.from({ length: 21 }, () => [0, 1, 2, 3]));
    expect(DASS21_SPANISH_CANDIDATE.items[0]?.promptOriginal)
      .not.toBe(DASS21_SPANISH_CANDIDATE.items[11]?.promptOriginal);

    expect(DASS21_ITEMS_BY_DIMENSION).toEqual({
      depression: [3, 5, 10, 13, 16, 17, 21],
      anxiety: [2, 4, 7, 9, 15, 19, 20],
      stress: [1, 6, 8, 11, 12, 14, 18],
    });

    for (const [dimension, numbers] of Object.entries(DASS21_ITEMS_BY_DIMENSION)) {
      expect(DASS21_SPANISH_CANDIDATE.items.filter(item => item.dimension === dimension).map(item => item.itemNumber).sort((a, b) => a - b)).toEqual([...numbers].sort((a, b) => a - b));
    }
  });

  it('records source hash and scoring-key cotejo but remains unavailable pending professional review', () => {
    expect(DASS21_SPANISH_CANDIDATE.candidateVersion).toBe(DASS21_SPANISH_CANDIDATE_VERSION);
    expect(DASS21_SPANISH_CANDIDATE.candidateVersion).toBe('dass21-spanish-candidate-1.1');
    expect(DASS21_SPANISH_CANDIDATE.language).toBe('es');
    expect(DASS21_SPANISH_CANDIDATE.sourceCotejoStatus).toBe('source_hash_matched_content_read_scoring_key_verified');
    expect(DASS21_SPANISH_CANDIDATE.translation.sourceSha256).toBe('b673e8b99bd521b856555e528daf8d4b1320a9928fe07114f26be6ac17ba021a');
    expect(DASS21_SPANISH_CANDIDATE.translation.hashVerification).toBe('matched_user_expected_hash_not_origin_proof');
    expect(DASS21_SPANISH_CANDIDATE.professionalReviewStatus).toBe('pending');
    expect(DASS21_SPANISH_CANDIDATE.approvalStatus).toBe('not_approved');
    expect(DASS21_SPANISH_CANDIDATE.availability).toBe('not_available');
    expect(DASS21_SPANISH_CANDIDATE.items[0]).toHaveProperty('promptOriginal');
    expect(DASS21_SPANISH_CANDIDATE.items[0]).not.toHaveProperty('questionId');
    expect(DASS21_SPANISH_CANDIDATE).not.toHaveProperty('instrumentVersionId');
    expect(Object.isFrozen(DASS21_SPANISH_CANDIDATE)).toBe(true);
    expect(Object.isFrozen(DASS21_SPANISH_CANDIDATE.items)).toBe(true);
    expect(Object.isFrozen(DASS21_SPANISH_CANDIDATE.items[0])).toBe(true);
  });

  it('rejects missing, reordered, dimension-mismatched, and invalid source scoring options', () => {
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: DASS21_SPANISH_CANDIDATE.items.slice(0, 20) })).toThrow();

    const reordered = [...DASS21_SPANISH_CANDIDATE.items];
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: reordered })).toThrow();

    const wrongDimension = DASS21_SPANISH_CANDIDATE.items.map(item => item.itemNumber === 1 ? { ...item, dimension: 'depression' } : item);
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: wrongDimension })).toThrow();

    const wrongOptions = DASS21_SPANISH_CANDIDATE.items.map(item => item.itemNumber === 1
      ? { ...item, responseOptions: [{ scoringValue: 0 as const, label: '0' }, { scoringValue: 1 as const, label: '1' }, { scoringValue: 2 as const, label: '2' }, { scoringValue: 2 as const, label: '3' }] }
      : item);
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: wrongOptions })).toThrow();
  });

  it('does not expose a draft or pending version through the existing instrument-info response', async () => {
    const pendingVersion = parseInstrumentVersion({
      instrumentId: '550e8400-e29b-41d4-a716-446655440001',
      instrumentVersionId: '550e8400-e29b-41d4-a716-446655440002',
      version: DASS21_SPANISH_CANDIDATE_VERSION,
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'draft',
      questions: [],
      approval: { status: 'pending', approvedAt: null, approvalReference: null },
      license: { status: 'not_reviewed', reference: null },
    });
    const catalog = {
      listAvailable: async () => [pendingVersion],
    } as never;
    await expect(new GetAssessmentInfo(catalog, () => new Date('2026-01-01T00:00:00.000Z')).execute())
      .resolves.toEqual({ assessmentAvailable: false, mode: 'structured_instrument', instruments: [] });
  });
});
