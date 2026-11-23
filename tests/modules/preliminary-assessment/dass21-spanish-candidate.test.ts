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
  it('describes exactly 21 ordered item slots with scoring dimensions and response values 0–3', () => {
    expect(DASS21_SPANISH_CANDIDATE.items).toHaveLength(21);
    expect(DASS21_SPANISH_CANDIDATE.items.map(item => item.itemNumber)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(DASS21_SPANISH_CANDIDATE.items.map(item => item.displayOrder)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(DASS21_SPANISH_CANDIDATE.items.map(item => item.responseValues)).toEqual(Array.from({ length: 21 }, () => [0, 1, 2, 3]));

    for (const [dimension, numbers] of Object.entries(DASS21_ITEMS_BY_DIMENSION)) {
      expect(DASS21_SPANISH_CANDIDATE.items.filter(item => item.dimension === dimension).map(item => item.itemNumber).sort((a, b) => a - b)).toEqual([...numbers].sort((a, b) => a - b));
    }
  });

  it('is versioned metadata only and remains unavailable pending source and professional review', () => {
    expect(DASS21_SPANISH_CANDIDATE.candidateVersion).toBe(DASS21_SPANISH_CANDIDATE_VERSION);
    expect(DASS21_SPANISH_CANDIDATE.language).toBe('es');
    expect(DASS21_SPANISH_CANDIDATE.itemTextStatus).toBe('not_included_pending_source_cotejo');
    expect(DASS21_SPANISH_CANDIDATE.professionalReviewStatus).toBe('pending');
    expect(DASS21_SPANISH_CANDIDATE.approvalStatus).toBe('not_approved');
    expect(DASS21_SPANISH_CANDIDATE.availability).toBe('not_available');
    expect(DASS21_SPANISH_CANDIDATE.items[0]).not.toHaveProperty('prompt');
    expect(DASS21_SPANISH_CANDIDATE.items[0]).not.toHaveProperty('questionId');
    expect(DASS21_SPANISH_CANDIDATE).not.toHaveProperty('instrumentVersionId');
    expect(Object.isFrozen(DASS21_SPANISH_CANDIDATE)).toBe(true);
    expect(Object.isFrozen(DASS21_SPANISH_CANDIDATE.items)).toBe(true);
    expect(Object.isFrozen(DASS21_SPANISH_CANDIDATE.items[0])).toBe(true);
  });

  it('rejects missing, reordered, dimension-mismatched, and invalid response-option slots', () => {
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: DASS21_SPANISH_CANDIDATE.items.slice(0, 20) })).toThrow();

    const reordered = [...DASS21_SPANISH_CANDIDATE.items];
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: reordered })).toThrow();

    const wrongDimension = DASS21_SPANISH_CANDIDATE.items.map(item => item.itemNumber === 1 ? { ...item, dimension: 'depression' } : item);
    expect(() => dass21SpanishCandidateSchema.parse({ ...DASS21_SPANISH_CANDIDATE, items: wrongDimension })).toThrow();

    const wrongOptions = DASS21_SPANISH_CANDIDATE.items.map(item => item.itemNumber === 1 ? { ...item, responseValues: [0, 1, 2, 4] } : item);
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
