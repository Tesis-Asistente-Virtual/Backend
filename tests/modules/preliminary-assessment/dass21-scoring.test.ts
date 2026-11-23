import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Dass21ScoringError, DASS21_SCORING_VERSION, scoreDass21, scoreDass21ForSyntheticTechnicalTest, DASS21_TECHNICAL_TEST_INSTRUMENT_ID, DASS21_TECHNICAL_TEST_VERSION_ID, DASS21_TECHNICAL_TEST_VERSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';

const instrument = {
  instrumentCode: 'DASS-21',
  instrumentId: randomUUID(),
  instrumentVersionId: randomUUID(),
  version: 'synthetic-fixture-v1',
  status: 'approved',
  approvalStatus: 'approved',
  licenseStatus: 'authorized',
} as const;

function answers(valueFor: (itemNumber: number) => number = () => 0, versionId = instrument.instrumentVersionId) {
  return Array.from({ length: 21 }, (_, index) => ({ instrumentVersionId: versionId, itemNumber: index + 1, value: valueFor(index + 1) }));
}

describe('DASS-21 deterministic scoring engine', () => {
  it('scores the three independently mapped dimensions and versions the result', () => {
    const result = scoreDass21({
      instrument,
      answers: answers(item => item <= 7 ? 1 : item <= 14 ? 2 : 3),
    });
    expect(result).toEqual({
      schemaVersion: '1.0',
      scoringVersion: DASS21_SCORING_VERSION,
      instrumentVersionId: instrument.instrumentVersionId,
      dimensions: {
        depression: { rawScore: 15, equivalentScore: 30 },
        anxiety: { rawScore: 14, equivalentScore: 28 },
        stress: { rawScore: 13, equivalentScore: 26 },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/diagnos|severity|mild|moderate|severe|priority|risk/i);
  });

  it('returns independent minimum and maximum values for every dimension', () => {
    const zero = scoreDass21({ instrument, answers: answers() });
    const max = scoreDass21({ instrument, answers: answers(() => 3) });
    for (const dimension of ['depression', 'anxiety', 'stress'] as const) {
      expect(zero.dimensions[dimension]).toEqual({ rawScore: 0, equivalentScore: 0 });
      expect(max.dimensions[dimension]).toEqual({ rawScore: 21, equivalentScore: 42 });
    }
  });

  it('permits technical scoring only for the exact pending synthetic candidate', () => {
    const candidate = {
      ...instrument, instrumentId: DASS21_TECHNICAL_TEST_INSTRUMENT_ID,
      instrumentVersionId: DASS21_TECHNICAL_TEST_VERSION_ID, version: DASS21_TECHNICAL_TEST_VERSION,
      status: 'draft', approvalStatus: 'pending', licenseStatus: 'not_reviewed',
    } as const;
    expect(() => scoreDass21({ instrument: candidate, answers: answers(() => 1, DASS21_TECHNICAL_TEST_VERSION_ID) }))
      .toThrowError(expect.objectContaining({ code: 'instrument_not_approved' }));
    const result = scoreDass21ForSyntheticTechnicalTest({ instrument: candidate, answers: answers(() => 1, DASS21_TECHNICAL_TEST_VERSION_ID) });
    expect(result.dimensions.depression).toEqual({ rawScore: 7, equivalentScore: 14 });
    expect(result.dimensions.anxiety).toEqual({ rawScore: 7, equivalentScore: 14 });
    expect(result.dimensions.stress).toEqual({ rawScore: 7, equivalentScore: 14 });
    expect(() => scoreDass21ForSyntheticTechnicalTest({ instrument: { ...candidate, instrumentVersionId: randomUUID() }, answers: answers(() => 1, DASS21_TECHNICAL_TEST_VERSION_ID) }))
      .toThrowError(expect.objectContaining({ code: 'instrument_not_approved' }));
  });

  it('uses the scoring key for each dimension without aggregating a global total', () => {
    const onePerScale = scoreDass21({
      instrument,
      answers: answers(item => [3, 5, 10, 13, 16, 17, 21].includes(item) ? 1 : 0),
    });
    expect(onePerScale.dimensions.depression).toEqual({ rawScore: 7, equivalentScore: 14 });
    expect(onePerScale.dimensions.anxiety.rawScore).toBe(0);
    expect(onePerScale.dimensions.stress.rawScore).toBe(0);
    expect(onePerScale).not.toHaveProperty('totalScore');
  });

  it('rejects missing, duplicate, unknown and out-of-range item answers', () => {
    expect(() => scoreDass21({ instrument, answers: answers().slice(0, 20) })).toThrowError(
      expect.objectContaining({ code: 'incomplete_answers' }),
    );
    const duplicate = answers();
    duplicate[20] = { instrumentVersionId: instrument.instrumentVersionId, itemNumber: 1, value: 0 };
    expect(() => scoreDass21({ instrument, answers: duplicate })).toThrowError(
      expect.objectContaining({ code: 'invalid_answers' }),
    );
    const unknown = answers();
    unknown[20] = { instrumentVersionId: instrument.instrumentVersionId, itemNumber: 22, value: 0 };
    expect(() => scoreDass21({ instrument, answers: unknown })).toThrowError(
      expect.objectContaining({ code: 'invalid_answers' }),
    );
    const outOfRange = answers();
    outOfRange[0] = { instrumentVersionId: instrument.instrumentVersionId, itemNumber: 1, value: 4 };
    expect(() => scoreDass21({ instrument, answers: outOfRange })).toThrowError(
      expect.objectContaining({ code: 'invalid_answers' }),
    );
  });

  it('rejects malformed metadata and an instrument that has not been approved/licensed', () => {
    expect(() => scoreDass21({ instrument: { instrumentVersionId: 'bad' }, answers: answers() })).toThrowError(
      expect.objectContaining({ code: 'invalid_instrument' }),
    );
    expect(() => scoreDass21({ instrument: { ...instrument, status: 'draft' }, answers: answers() })).toThrowError(
      expect.objectContaining({ code: 'instrument_not_approved' }),
    );
    expect(() => scoreDass21({ instrument: { ...instrument, licenseStatus: 'restricted' }, answers: answers() })).toThrowError(
      expect.objectContaining({ code: 'instrument_not_approved' }),
    );
    expect(() => scoreDass21({ instrument: { ...instrument, instrumentCode: 'other' }, answers: answers() })).toThrowError(
      expect.objectContaining({ code: 'invalid_instrument' }),
    );
    expect(() => scoreDass21({ instrument, answers: answers(() => 0, randomUUID()) })).toThrowError(
      expect.objectContaining({ code: 'instrument_version_mismatch' }),
    );
  });

  it('uses safe domain errors without including synthetic responses in the message', () => {
    try {
      scoreDass21({ instrument, answers: [{ itemNumber: 1, value: 999, sensitive: 'fictional-private-answer' }] });
      throw new Error('Expected scoring validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Dass21ScoringError);
      expect((error as Error).message).not.toContain('fictional-private-answer');
    }
  });
});
