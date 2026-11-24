import { describe, expect, it } from 'vitest';
import { findClinicalResultFieldPaths } from '../helpers/clinical-result-shape.js';

describe('preliminary guidance clinical-result shape assertion', () => {
  it('allows explicit non-diagnostic warnings and non-scoring limitations', () => {
    const guidance = {
      summary: { interpretationLimits: ['not_a_diagnosis', 'clinical_severity_not_calculated'] },
      preliminaryGuidance: {
        limitations: ['No es una evaluación ni un diagnóstico clínico y no calcula puntuaciones o niveles de severidad.'],
        observations: [], informationGaps: [{ field: 'duration', reason: 'not_assessed' }],
      },
    };
    expect(findClinicalResultFieldPaths(guidance)).toEqual([]);
  });

  it('finds score, category, and diagnosis fields at any nesting depth', () => {
    const leakedResult = {
      summary: { details: [{ rawScore: 3 }, { nested: { equivalent_score: 6 } }] },
      preliminaryGuidance: { category: 'mild', isDiagnostic: false, clinical_diagnosis: 'example' },
    };
    expect(findClinicalResultFieldPaths(leakedResult)).toEqual([
      '$.summary.details[0].rawScore',
      '$.summary.details[1].nested.equivalent_score',
      '$.preliminaryGuidance.category',
      '$.preliminaryGuidance.isDiagnostic',
      '$.preliminaryGuidance.clinical_diagnosis',
    ]);
  });
});
