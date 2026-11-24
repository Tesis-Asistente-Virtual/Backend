import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dass21InternalResultSchema } from '../../../src/modules/preliminary-assessment/domain/model/dass21-internal-result.js';
import { DASS21_INTERPRETATION_VERSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-interpretation.js';
import { dass21ParticipantResultSchema, toDass21ParticipantResult } from '../../../src/modules/preliminary-assessment/interfaces/rest/transformers/dass21-participant-result-transformer.js';
import { preliminaryAssessmentPaths, preliminaryAssessmentSchemas } from '../../../src/modules/preliminary-assessment/interfaces/rest/openapi.js';

function internalResult() {
  return dass21InternalResultSchema.parse({
    schemaVersion: '1.0', resultVersion: 'dass21-internal-result-1.0', status: 'available',
    assessmentId: randomUUID(),
    instrument: {
      code: 'DASS-21', instrumentId: randomUUID(), instrumentVersionId: randomUUID(), version: 'synthetic-unapproved-v1',
    },
    scoringVersion: 'dass21-score-1.0', interpretationVersion: DASS21_INTERPRETATION_VERSION,
    dimensions: {
      depression: { rawScore: 4, equivalentScore: 8, category: 'normal' },
      anxiety: { rawScore: 4, equivalentScore: 8, category: 'mild' },
      stress: { rawScore: 17, equivalentScore: 34, category: 'extremely_severe' },
    },
    limitations: [
      'not_a_diagnosis', 'conventional_categories_are_not_clinical_severity', 'not_for_automated_treatment_or_safety_decisions',
    ],
  });
}

describe('future DASS-21 participant result DTO projection', () => {
  it('projects the validated internal DTO with exact versions, three dimensions, scores, and non-diagnostic limitations', () => {
    const internal = internalResult();
    const result = toDass21ParticipantResult(internal);
    expect(dass21ParticipantResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      status: 'available', assessmentId: internal.assessmentId,
      instrument: internal.instrument, scoringVersion: internal.scoringVersion,
      interpretationVersion: internal.interpretationVersion, isDiagnostic: false,
      dimensions: internal.dimensions,
    });
    if (result.status !== 'available') throw new Error('Expected synthetic available contract');
    expect(Object.keys(result.dimensions)).toEqual(['depression', 'anxiety', 'stress']);
    expect(result.dimensions.depression).toEqual({ rawScore: 4, equivalentScore: 8, category: 'normal' });
    expect(result).not.toHaveProperty('overallCategory');
    expect(result).not.toHaveProperty('accountId');
    expect(result.limitations).toContain('not_derived_from_conversation');
  });

  it('supports all five conventional category labels without collapsing dimensions', () => {
    const internal = internalResult();
    const categories = ['normal', 'mild', 'moderate', 'severe', 'extremely_severe'] as const;
    const scoresByCategory = {
      normal: [{ rawScore: 4, equivalentScore: 8 }, { rawScore: 3, equivalentScore: 6 }, { rawScore: 6, equivalentScore: 12 }],
      mild: [{ rawScore: 5, equivalentScore: 10 }, { rawScore: 4, equivalentScore: 8 }, { rawScore: 8, equivalentScore: 16 }],
      moderate: [{ rawScore: 7, equivalentScore: 14 }, { rawScore: 5, equivalentScore: 10 }, { rawScore: 10, equivalentScore: 20 }],
      severe: [{ rawScore: 11, equivalentScore: 22 }, { rawScore: 8, equivalentScore: 16 }, { rawScore: 14, equivalentScore: 28 }],
      extremely_severe: [{ rawScore: 14, equivalentScore: 28 }, { rawScore: 10, equivalentScore: 20 }, { rawScore: 17, equivalentScore: 34 }],
    } as const;
    let result: ReturnType<typeof toDass21ParticipantResult> | undefined;
    for (const category of categories) {
      const [depression, anxiety, stress] = scoresByCategory[category];
      const internalVariant = dass21InternalResultSchema.parse({ ...internal, dimensions: {
        depression: { ...depression, category }, anxiety: { ...anxiety, category }, stress: { ...stress, category },
      } });
      result = toDass21ParticipantResult(internalVariant);
      expect(dass21ParticipantResultSchema.parse(result)).toEqual(result);
      expect(result.status).toBe('available');
      if (result.status !== 'available') throw new Error('Expected synthetic available contract');
      expect(Object.values(result.dimensions).map(dimension => dimension.category)).toEqual([category, category, category]);
    }
  });

  it('collapses internal denial details to a generic not_available response', () => {
    const unavailable = dass21InternalResultSchema.parse({
      schemaVersion: '1.0', resultVersion: 'dass21-internal-result-1.0', status: 'not_available',
      assessmentId: randomUUID(), reason: 'consent_required', limitations: ['not_a_diagnosis', 'not_for_participant_display'],
    });
    expect(toDass21ParticipantResult(unavailable)).toEqual({
      contractVersion: 'dass21-participant-result-1.0', status: 'not_available',
      assessmentId: unavailable.assessmentId, reason: 'result_not_available', isDiagnostic: false,
      limitations: ['not_a_diagnosis', 'result_not_available_until_authorized'],
    });
  });

  it('rejects invalid source scores and documents the conditional /result contract', () => {
    const internal = internalResult();
    expect(() => toDass21ParticipantResult({
      ...internal,
      dimensions: { ...internal.dimensions, depression: { rawScore: 4, equivalentScore: 7, category: 'normal' } },
    } as never)).toThrow();
    expect(preliminaryAssessmentSchemas.Dass21ParticipantResult).toHaveProperty('description');
    expect(preliminaryAssessmentPaths['/api/v1/preliminary-assessments/{id}/result'].get.responses['200'])
      .toMatchObject({ content: { 'application/json': { schema: { oneOf: [
        { $ref: '#/components/schemas/AssessmentResult' },
        { $ref: '#/components/schemas/Dass21ParticipantResultEnvelope' },
      ] } } } });
  });
});
